import { requiresActivation, canStartGeometryDrag, activationGestureMode, canDragEntityDirectly, guideDirectionsParallel, nearestCompoundGuideIntersection, nonOverlappingPanelTop, normalizeDirectionalSnapModes, polarRayGuides, preferredSnapCandidate, resolvePolarSnap, selectionFilterForProject, shouldDelayTapZoom, snapCandidateScore, tapZoomMoveIntent, tapZoomScale } from "./core/interaction.js?v=234";
import { radToDeg, normalizeDegrees, normalizeAnglePositive, offsetWall, transformBlockPoint, distanceWorld, angleBetweenPoints, arcGeometry, segmentMetrics, normalizeScreenVector, entityBounds, pointInSelectionRect, rectEdges, segmentsIntersect, pointInPolygon, pointToSegmentDistance } from "./core/geometry.js?v=225";
import { entitySize, blockSegments } from "./core/blocks.js";
import { buildBlockPreview } from "./core/block-preview.js";
import { canExplodeEntity, createReusableBlockDefinition, createReusableBlockInstance, expandDrawingBlocks, expandReusableBlock, explodeEntity,
  isReusableBlock, MAX_REUSABLE_BLOCKS, normalizeBlockName, normalizeReusableBlocks, reusableBlockBounds, reusableBlockTransform } from "./core/reusable-blocks.js";
import { buildDxf, buildRevitDxf } from "./core/dxf.js";
import { importDxf } from "./core/dxf-import.js";
import { readNativeImportFile } from "./core/native-file-import.js";
import { angularDimensionGeometry, dimensionGeometry } from "./core/dimensions.js";
import { additionalDimensionArtwork, additionalDimensionKinds, additionalDimensionPaths, angularDimensionArtwork, linearDimensionArtwork, radialDimensionArtwork } from "./core/dimension-artwork.js";
import { constrainLinePoint, linePointWithConstraint, linePolarPoint, parseLineDecimal } from "./core/line-input.js";
import { addNumericStepper, normalizeNumericStep, NUMERIC_STEPS } from "./core/numeric-stepper.js";
import { isLinePoint, isValidLine, joinLines, MAX_LINE_COORDINATE, mirrorLine, nearbyBoundaryPoints, nearbyIntersections, nearbyPerpendiculars, nearestBoundaryPoint, nearestIntersection, nearestLineExtension, nearestPerpendicular, parallelLine, scaleLine } from "./core/line-edits.js";
import { draftArcFromBend, editableFigure, extendFigure, figureGripPoints, figureReferenceAt, figureReferencePoint, projectFigurePoint, reshapeFigure, splitFigure, trimFigure, validFigurePiece } from "./core/figure-edits.js";
import { filletSelectedCorners, filletSelectedPair } from "./core/line-fillet.js";
import { diameterCircle, tangentRadiusCircle, threePointCircle } from "./core/circle-tools.js";
import { createPolyline, polylineBounds, polylineSegments, validPolylinePoints } from "./core/polyline.js";
import { createRevisionCloud, MAX_REVISION_CLOUD_CORNERS, revisionCloudRectangle } from "./core/revision-cloud.js";
import { buildPlotPdf, pdfPlotBounds } from "./core/pdf.js";
import { chooseProjectSource, projectRevision } from "./core/sync.js";
import { rotateStoredEntity, scaleStoredEntity } from "./core/entity-transform.js";
import { IMPORT_UNIT_FACTORS, scaleImportedProject } from "./core/project-import.js";
import { MAX_ZAMER_FILE_BYTES, validStoredEntity, validateZamerProject } from "./core/project-format.js";
import { driveProjectStamp, googleAccountForToken, googleDriveProjects, syncDriveProjects } from "./core/google-drive-projects.js";
import { DEFAULT_LINE_LAYER, DEFAULT_LINE_TYPE, DEFAULT_LINE_WEIGHT, LINE_TYPE_VALUES, LINE_WEIGHT_VALUES, MAX_CUSTOM_LINE_LAYERS, MAX_LINE_LAYER_NAME_LENGTH, normalizeActiveLineLayer, normalizeLineLayerColor, normalizeLineLayerName, normalizeLineLayerSettings, normalizeLineType, normalizeLineWeight, resolveLineStyle } from "./core/line-layers.js";
import { buildProjectPreview } from "./core/project-preview.js";
import { describeSurveyRecord, measureSurveyContour, normalizeSurvey, normalizeSurveyRecord, surveyMarkers, surveyRoom } from "./core/survey.js";
import { bindSurveyPanel } from "./core/survey-panel.js";
import { createSurveyLaser } from "./core/survey-laser.js";
import { buildZip } from "./core/zip.js";
import { formatProjectAngle, formatProjectArea, formatProjectElevation, formatProjectLength,
  fromProjectLength, normalizeMeasurementSettings, projectUnit, toProjectLength } from "./core/project-settings.js";
import { createPlanAnnotation, normalizePlanAnnotation, planAnnotationAnchors, planAnnotationGeometry, planAnnotationPointsFromEntity, planAnnotationSnapGeometry, planZoneLabelHeight, planZoneLabelLines, tessellatePolyline, totalPlanAreaM2, MAX_PLAN_ANNOTATION_POINTS, PLAN_AREA_COLOR, PLAN_ELEVATION_STYLES } from "./core/plan-annotations.js";
import { planRegionAtPoint } from "./core/plan-region.js";
import { nativeSpenClientPoint, normalizeSpenSettings, shouldRejectSpenPalmTouch, spenBarrelButtonPressed, spenModeActive } from "./core/spen.js";
import { ANNOTATION_LINE_SPACING, ANNOTATION_SCALE_PRESETS, annotationScaleFactor, annotationTextLines, annotationTextWidth, annotationWorldSize, auxiliaryAnnotationSize, leaderAppearance, leaderElbowPoint, leaderFrameSize, leaderPlanPath, leaderTextHeight, textBlockLayout } from "./core/annotation-text.js";


// Local vector icons share a 24px grid and never depend on platform emoji fonts.
function cadIcon(name) {
  const paths = {
    cursor: '<path d="m5 3 14 9-7 2-3 7Z"/>',
    finger: '<path d="M9 12V4a2 2 0 0 1 4 0v6l4-1a3 3 0 0 1 4 3l-1 7a3 3 0 0 1-3 2h-5a4 4 0 0 1-3-2l-5-6a2 2 0 0 1 3-2l2 2"/>',
    frame: '<rect x="4" y="4" width="16" height="16" rx="2" stroke-dasharray="3 2"/><rect x="8" y="8" width="8" height="8" rx="1"/>',
    back: '<path d="M19 12H5m7-7-7 7 7 7"/>',
    line: '<path d="m5 19 14-14"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="5" r="2"/>',
    dimension: '<path d="M4 5v14m16-14v14M4 12h16m-12-3-4 3 4 3m8-6 4 3-4 3"/>',
    text: '<path d="M5 5h14M12 5v15m-4 0h8"/>',
    area: '<path d="M3 5h18v14H3zm6 4h6m-6 6h6"/>',
    elevation: '<path d="M4 5h12L5 18h12m2-9 2-2 2 2m-2-2v12"/>',
    revisionCloud: '<path d="M6 18a3 3 0 0 1-2-5.4A3.4 3.4 0 0 1 8 8a4.1 4.1 0 0 1 7-.8 3.3 3.3 0 0 1 4.5 4.5A3.3 3.3 0 0 1 18 18a3.3 3.3 0 0 1-4 1 3.7 3.7 0 0 1-5 0 3.1 3.1 0 0 1-3-1Z"/>',
    trace: '<path d="m4 7 11-4 5 5v11l-11 2-5-5Zm0 0 5 5 11-4M9 12v9"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
    file: '<path d="M14 3H6v18h12V7zM14 3v5h4M9 14h6m-3-3v6"/>',
    plan: '<path d="M3 3h18v18H3zM3 11h9V3m0 8v5m0 5v-2m3-8h6"/>',
    import: '<path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/>',
    openFolder: '<path d="M3 18V6a2 2 0 0 1 2-2h4l2 3h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Zm4-5h9m-3-3 3 3-3 3"/>',
    export: '<path d="M12 16V3m-4 4 4-4 4 4M4 16v5h16v-5"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    history: '<path d="M3 12a9 9 0 1 1 2 5.7M3 7v5h5m4-5v5l3 2"/>',
    undo: '<path d="m8 4-5 5 5 5M3 9h10a7 7 0 0 1 0 14"/>',
    redo: '<path d="m16 4 5 5-5 5m5-5H11a7 7 0 0 0 0 14"/>',
    layers: '<path d="m12 3 10 5-10 5L2 8Zm-10 9 10 5 10-5M2 17l10 5 10-5"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v3"/>',
    unlock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 7-2m-3 9v3"/>',
    color: '<path d="m14 4 6 6M8 17l-3 2-2-2 2-3 10-10 5 5L10 19Z"/>',
    weight: '<path d="M4 6h16M4 12h16M4 18h16"/><path d="M4 6h16" stroke-width="1"/><path d="M4 12h16" stroke-width="2"/><path d="M4 18h16" stroke-width="3"/>',
    lineType: '<path d="M4 6h16"/><path d="M4 12h16" stroke-dasharray="4 3"/><path d="M4 18h16" stroke-dasharray="1 3"/>',
    settings: '<path d="M3 6h10m6 0h2M3 12h2m6 0h10M3 18h7m6 0h5"/><circle cx="16" cy="6" r="2.5"/><circle cx="8" cy="12" r="2.5"/><circle cx="13" cy="18" r="2.5"/>',
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
    circleCenter: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="1.5"/><path d="m12 12 5.7-5.7"/>',
    circleDiameter: '<circle cx="12" cy="12" r="8"/><path d="M4 12h16"/><circle cx="4" cy="12" r="1.2"/><circle cx="20" cy="12" r="1.2"/>',
    circleThree: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="4" r="1.2"/><circle cx="5.1" cy="16" r="1.2"/><circle cx="18.9" cy="16" r="1.2"/>',
    circleTangent: '<path d="M3 5h18M3 19h18"/><circle cx="12" cy="12" r="7"/><circle cx="12" cy="5" r="1.2"/><circle cx="12" cy="19" r="1.2"/>',
    arc: '<path d="M3 18a9 9 0 0 1 18 0"/>',
    rectangle: '<rect x="3" y="5" width="18" height="14" rx="1"/>',
    block: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9zm0 9 8-4.5M12 12 4 7.5m8 4.5v9"/>',
    explode: '<path d="m10 10-5-5m0 5V5h5m4 5 5-5m-5 0h5v5m-9 4-5 5m0-5v5h5m4-5 5 5m-5 0h5v-5"/>',
    measure: '<path d="m3 16 13-13 5 5L8 21Zm5-5 2 2m1-5 2 2m1-5 2 2"/>',
    measureRadius: '<circle cx="12" cy="12" r="9"/><path d="m12 12 6.4-6.4m-4.4 0h4.4V10"/><circle cx="12" cy="12" r="1"/>',
    measurePerimeter: '<path d="M4 8 11 4l9 4v8l-5 4L4 16Z" stroke-dasharray="3 2"/>',
    closeContour: '<path d="M18 14v6H4V5h12m-8 7 3 3 8-8"/>',
    addContour: '<path d="M13 5H4v15h14v-6m-1-10v8m-4-4h8"/>',
    angle: '<path d="M4 4v16h16M4 13a7 7 0 0 1 7 7"/>',
    edit: '<path d="m4 16 12-12 4 4L8 20H4Zm10-10 4 4"/>',
    properties: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 8h8m-8 4h8m-8 4h5"/>',
    check: '<path d="m4 12 5 5L20 6"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    breakGap: '<path d="m3 19 6-6m6-2 6-6m-13 6 3 3m2-4 3 3"/>',
    breakPoint: '<path d="m3 20 7-7m4-4 7-7"/><circle cx="12" cy="11" r="2.5"/>',
    join: '<path d="m3 18 6-6h6l6-6M6 11l3 1-1 4m10-3-3-1 1-4"/>',
    fillet: '<path d="M5 20v-7a8 8 0 0 1 8-8h7"/>',
    scale: '<path d="M10 4h10v10m0-10-7 7m1 9H4V10m0 10 7-7"/>',
    group: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><path d="M10 6.5h4M6.5 10v4m11-4v4M10 17.5h4"/>',
    lasso: '<path d="M6 7c3.5-3.5 10.5-3.2 13 1.5 2.2 4.2-.8 9.3-6 10.3-4.8.9-9.8-1.8-9-6.2.3-2 1-3.5 2-5.6Z" stroke-dasharray="2.5 2"/>',
    mirror: '<path d="M12 3v18M9 7 4 16h5m6-9 5 9h-5"/>',
    mirrorHorizontal: '<path d="M3 12h18M7 9l9-5v5m-9 6 9 5v-5Z"/>',
    mirrorLineAxis: '<path d="m3 21 18-18M4 14V5h9m-2 14h9v-9"/>',
    replaceOriginal: '<path d="M17 4h3v3M8 4h5M4 4v3m0 4v3m3 6H4v-3m16 0v3h-3m-4 0h-3m-3-9 4 4 7-7"/>',
    offset: '<path d="M5 19 15 9m-5 10L20 9M7 12l-2-2m4-2 2 2"/>',
    percent: '<path d="m5 19 14-14"/><circle cx="7" cy="7" r="2"/><circle cx="17" cy="17" r="2"/>',
    exit: '<path d="M10 4H4v16h6m5-12 4 4-4 4m-6-4h10"/>',
    update: '<path d="M20 5v5h-5m5 0a8 8 0 1 0-2 8m-6-9v6m-2.5-2.5 2.5 2.5 2.5-2.5"/>',
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
const apkDeviceUser = { id: "offline", login: "На телефоне" };
const googleAccountKey = "zamer.apk.google.account";
const googleMigrationKey = "zamer.apk.google.migration";
const googleBridgeAvailable = nativeApkMode && typeof window.ZamerAndroid?.authorizeGoogle === "function";
const restoredGoogleAccount = googleBridgeAvailable ? apkReadJson(googleAccountKey, null) : null;
let apkUser = /^google-\d{1,40}$/.test(restoredGoogleAccount?.id) && typeof restoredGoogleAccount.login === "string"
  ? restoredGoogleAccount : apkDeviceUser;

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

function apkScopedKey(owner, deviceKey, googleKey) {
  return owner === apkDeviceUser.id ? deviceKey : `zamer.apk.${owner}.${googleKey}`;
}

function apkProjectKey(projectId, owner) {
  return `${apkScopedKey(owner, apkProjectPrefix, "project.")}${projectId}`;
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

function apkReadProjectIndex(owner) {
  const indexed = apkReadJson(apkScopedKey(owner, apkProjectIndexKey, "index"), []);
  return Array.isArray(indexed) ? indexed.filter((project) => project?.id) : [];
}

function apkWriteProjectIndex(projects, owner) {
  localStorage.setItem(apkScopedKey(owner, apkProjectIndexKey, "index"), JSON.stringify(projects));
}

function apkStoreProject(project) {
  const owner = project.clientId;
  localStorage.setItem(apkProjectKey(project.projectId, owner), JSON.stringify(project));
  try {
    const projects = apkReadProjectIndex(owner).filter((item) => item.id !== project.projectId);
    projects.unshift(apkProjectMeta(project));
    apkWriteProjectIndex(projects, owner);
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
    if (!(await saveProjectToLocalStore(project, "device-storage", projectIdentity(project.projectId, project.clientId)))) throw error;
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

async function apkArchivedProjectIds(owner) {
  const prefix = owner === apkDeviceUser.id ? "" : `${owner}:`;
  const ids = (await apkIndexedRecords("trash", true)).filter((id) => typeof id === "string" &&
    (prefix ? id.startsWith(prefix) : !id.includes(":"))).map((id) => id.slice(prefix.length));
  const legacyPrefix = apkScopedKey(owner, apkTrashPrefix, "trash.");
  const legacy = apkStorageKeys().filter((key) => key.startsWith(legacyPrefix)).map((key) => key.slice(legacyPrefix.length));
  return new Set([...ids, ...legacy].map((key) => key.slice(0, key.lastIndexOf("."))));
}

async function apkReadTrash(owner) {
  const entries = new Map((await apkIndexedRecords("trash")).filter((entry) =>
    (entry.project?.clientId || apkDeviceUser.id) === owner).map((entry) => [entry.id, entry]));
  const prefix = apkScopedKey(owner, apkTrashPrefix, "trash.");
  for (const key of apkStorageKeys()) {
    if (!key.startsWith(prefix)) continue;
    const project = apkReadJson(key, null);
    if (!project?.projectId) continue;
    const id = owner === apkDeviceUser.id ? key.slice(prefix.length) : `${owner}:${key.slice(prefix.length)}`;
    if (!entries.has(id)) entries.set(id, { id, project, deletedAt: Number(id.split(".").at(-1)) || 0, legacy: true });
  }
  return [...entries.values()].sort((a, b) => b.deletedAt - a.deletedAt);
}

async function apkListProjects(owner) {
  const stored = new Map();
  for (const project of await apkIndexedRecords("projects")) {
    if (project.clientId === owner && project.projectId) stored.set(project.projectId, project);
  }
  for (const key of apkStorageKeys()) {
    if (!key.startsWith(apkProjectKey("", owner)) && !key.startsWith(`zamer.project.${owner}.`)) continue;
    const project = apkReadJson(key, null);
    if (project?.projectId) stored.set(project.projectId, newestProject(stored.get(project.projectId), project));
  }
  const archived = await apkArchivedProjectIds(owner);
  const indexed = new Map(apkReadProjectIndex(owner).map((meta) => [meta.id, meta]));
  for (const project of stored.values()) indexed.set(project.projectId, apkProjectMeta(project));
  return [...indexed.values()].filter((meta) => !archived.has(meta.id))
    .sort((a, b) => Date.parse(b.updatedAt || "") - Date.parse(a.updatedAt || ""));
}

async function apkArchiveProject(project, identity) {
  const deletedAt = Date.now();
  const owner = identity.clientId;
  const archive = `${project.projectId}.${deletedAt}`;
  const id = owner === apkDeviceUser.id ? archive : `${owner}:${archive}`;
  await persistence.localWriteChain.catch(() => {});
  try {
    const db = await openLocalProjectDb();
    if (!db) throw new Error("IndexedDB is unavailable");
    const transaction = db.transaction(["trash", "projects"], "readwrite");
    transaction.objectStore("trash").put({ id, project, deletedAt });
    transaction.objectStore("projects").delete(projectStorageId(identity));
    await idbTransactionDone(transaction);
  } catch (error) {
    localStorage.setItem(`${apkScopedKey(owner, apkTrashPrefix, "trash.")}${archive}`, JSON.stringify(project));
  }
  try {
    localStorage.removeItem(apkProjectKey(project.projectId, owner));
    localStorage.removeItem(localProjectFallbackKey(identity));
    apkWriteProjectIndex(apkReadProjectIndex(owner).filter((item) => item.id !== project.projectId), owner);
  } catch (error) {
    console.warn("Project index update failed", error);
  }
}

async function apkRestoreTrash(id, owner) {
  const entry = (await apkReadTrash(owner)).find((item) => item.id === id);
  if (!entry) return null;
  const original = entry.project;
  const oldId = apkSafeId(original.projectId);
  const primary = apkReadJson(apkProjectKey(oldId, owner), null);
  const identity = projectIdentity(oldId, owner);
  if (entry.legacy) {
    const occupied = owner !== apkDeviceUser.id || primary || await loadProjectFromLocalStore(identity);
    const project = await apkPersistProject(apkCreateProject({ id: occupied ? "" : oldId, name: original.name, project: original }, owner));
    localStorage.removeItem(`${apkScopedKey(owner, apkTrashPrefix, "trash.")}${id.split(":").at(-1)}`);
    return project;
  }
  const db = await openLocalProjectDb();
  const transaction = db.transaction(["trash", "projects"], "readwrite");
  const completed = idbTransactionDone(transaction);
  completed.catch(() => {});
  const trash = transaction.objectStore("trash");
  const live = transaction.objectStore("projects");
  const [stillArchived, existing] = await Promise.all([
    idbRequest(trash.get(id)), idbRequest(live.get(projectStorageId(identity))),
  ]);
  if (!stillArchived) {
    await completed;
    return null;
  }
  const project = apkCreateProject({ id: owner !== apkDeviceUser.id || primary || existing ? "" : oldId, name: original.name, project: original }, owner);
  live.put({ ...project, storageId: projectStorageId(projectIdentity(project.projectId, owner)), localSavedAt: project.savedAt });
  trash.delete(id);
  await completed;
  try {
    apkStoreProject(project);
  } catch (error) {
    console.warn("The restored project is in IndexedDB", error);
  }
  return project;
}

function apkCreateProject(body = {}, owner) {
  const now = new Date().toISOString();
  const source = body.project && typeof body.project === "object" ? body.project : {};
  const projectId = apkSafeId(body.id, `p-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const lineLayers = normalizeLineLayerSettings(source);
  return {
    version: 2,
    clientId: owner,
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
    view: source.view || { scale: DEFAULT_VIEW_SCALE, panX: 92, panY: 84 },
    snaps: [...normalizeDirectionalSnapModes(Array.isArray(source.snaps) ? source.snaps : ["grid", "end", "polar"])],
    gridStep: GRID_STEPS.includes(source.gridStep) ? source.gridStep : 100,
    polarStep: POLAR_STEPS.includes(source.polarStep) ? source.polarStep : 5,
    numericStep: normalizeNumericStep(source.numericStep),
    visibleLayers: Array.isArray(source.visibleLayers) ? source.visibleLayers : projectDefaultLayers(source, lineLayers.customLineLayers),
    ...lineLayers,
    annotationLayers: source.annotationLayers === 1 ? 1 : undefined,
    annotationScale: Number.isFinite(source.annotationScale) ? source.annotationScale : 1,
    measurementSettings: normalizeMeasurementSettings(source.measurementSettings),
    selectionFilter: selectionFilterForProject(source.selectionFilter),
    survey: normalizeSurvey(source.survey),
    draft: source.draft,
    reusableBlocks: normalizeReusableBlocks(source.reusableBlocks),

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

async function apkReadProject(projectId, owner) {
  const primary = apkReadJson(apkProjectKey(projectId, owner), null);
  const local = await loadProjectFromLocalStore(projectIdentity(projectId, owner));
  return chooseProjectSource(local, primary).project;
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
  const owner = apkUser.id;
  try {
    if (requestUrl.pathname === "/api/health") return apkJsonResponse(200, { ok: true, storage: "phone" });
    if (requestUrl.pathname === "/api/auth/status") return apkJsonResponse(200, { ok: true, user: apkUser, offline: true });
    if (requestUrl.pathname === "/api/auth/logout") return apkJsonResponse(200, { ok: true, user: apkUser, offline: true });
    if (["/api/auth/login", "/api/auth/register", "/api/auth/dev"].includes(requestUrl.pathname)) {
      return apkJsonResponse(200, { ok: true, user: apkUser, offline: true });
    }
    const requestedOwner = requestUrl.searchParams.get("client");
    if (requestedOwner && requestedOwner !== owner) return apkJsonResponse(409, { ok: false, error: "Аккаунт изменился" });

    if (requestUrl.pathname === "/api/projects" && method === "GET") {
      return apkJsonResponse(200, { ok: true, client: owner, projects: await apkListProjects(owner) });
    }
    if (requestUrl.pathname === "/api/projects" && method === "POST") {
      const body = await apkRequestBody(resource, options, method);
      const nextProject = apkCreateProject(body, owner);
      if (body.id) {
        if (await apkReadProject(nextProject.projectId, owner) || (await apkArchivedProjectIds(owner)).has(nextProject.projectId)) {
          return apkJsonResponse(409, { ok: false, error: "Такой проект уже существует" });
        }
      }
      const project = await apkPersistProject(nextProject);
      scheduleGoogleSync(owner);
      return apkJsonResponse(200, { ok: true, client: owner, project, meta: apkProjectMeta(project) });
    }
    if (requestUrl.pathname === "/api/trash" && method === "GET") {
      const entries = (await apkReadTrash(owner)).map((entry) => ({ ...apkProjectMeta(entry.project), id: entry.id, deletedAt: entry.deletedAt }));
      return apkJsonResponse(200, { ok: true, entries });
    }
    if (requestUrl.pathname === "/api/trash/restore" && method === "POST") {
      const body = await apkRequestBody(resource, options, method);
      const project = await apkRestoreTrash(body.id, owner);
      if (project) scheduleGoogleSync(owner);
      return project ? apkJsonResponse(200, { ok: true, project }) : apkJsonResponse(404, { ok: false, error: "Проект в корзине не найден" });
    }

    const match = requestUrl.pathname.match(/^\/api\/projects\/([^/]+)$/);
    const projectId = match ? apkSafeId(decodeURIComponent(match[1]), "") : "";
    if (!projectId) return apkJsonResponse(404, { ok: false, error: "Project not found" });
    if ((await apkArchivedProjectIds(owner)).has(projectId)) {
      return apkJsonResponse(410, { ok: false, error: "Проект в корзине", projectId });
    }
    const identity = projectIdentity(projectId, owner);
    const primary = apkReadJson(apkProjectKey(projectId, owner), null);
    const local = await loadProjectFromLocalStore(identity);
    const current = chooseProjectSource(local, primary).project;

    if (method === "GET") {
      return current
        ? apkJsonResponse(200, { ok: true, client: owner, projectId, project: current })
        : apkJsonResponse(404, { ok: false, error: "Project not found", projectId });
    }
    if (method === "DELETE") {
      if (!current) return apkJsonResponse(404, { ok: false, error: "Проект не найден" });
      if (owner !== apkDeviceUser.id) await writeGoogleProjectState(owner, projectId, { remove: true });
      await apkArchiveProject(current, identity);
      scheduleGoogleSync(owner);
      return apkJsonResponse(200, { ok: true, client: owner, projectId, recoverable: true });
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
        clientId: owner,
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
      scheduleGoogleSync(owner);
      return apkJsonResponse(200, { ok: true, client: owner, projectId, revision, savedAt: now, meta: apkProjectMeta(project) });
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
const viewportCoordinates = document.getElementById("viewportCoordinates");
const cursorCoordinateX = document.getElementById("cursorCoordinateX");
const cursorCoordinateY = document.getElementById("cursorCoordinateY");
const cursorCoordinateUnit = document.getElementById("cursorCoordinateUnit");
const projectOrigin = { x: 0, y: 0 };
const shell = document.querySelector(".app-shell");
const workspace = document.querySelector(".workspace");
const centerCursor = document.querySelector(".center-cursor");
const quickMeasureUi = Object.fromEntries(["Button", "Panel", "Mode", "Method", "Finish", "Close", "Value", "Hint", "Result"]
  .map((key) => [key.toLowerCase(), document.getElementById(`quickMeasure${key}`)]));
const quickMeasureModeButtons = [...quickMeasureUi.mode.querySelectorAll("button[data-measure-mode]")];
const quickMeasureMethodButtons = [...quickMeasureUi.method.querySelectorAll("button[data-measure-method]")];
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
const homeThemeButton = document.getElementById("homeThemeButton");
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
const escapeSelectButton = document.getElementById("escapeSelectButton");
const frameToolButton = document.getElementById("frameToolButton");
const figureToolButton = document.getElementById("figureToolButton");
const quickEditModes = document.getElementById("quickEditModes");
const quickEditButtons = [...quickEditModes.querySelectorAll("[data-quick-edit]")];
const quickMoveTool = document.getElementById("quickMoveTool");
const quickCopyTool = document.getElementById("quickCopyTool");
const quickScaleTool = document.getElementById("quickScaleTool");
const ordinateModes = document.getElementById("ordinateModes");
const radialModes = document.getElementById("radialModes");
const chainControls = document.getElementById("chainControls");
const circleControls = document.getElementById("circleControls");
const circleConstruction = document.getElementById("circleConstruction");
const circleModeButtons = [...circleConstruction.querySelectorAll("[data-circle-mode]")];
const circleTangentForm = document.getElementById("circleTangentForm");
const circleTangentRadius = document.getElementById("circleTangentRadius");
const circleTangentUnit = document.getElementById("circleTangentUnit");
const circleTangentError = document.getElementById("circleTangentError");
const angleModes = document.getElementById("angleModes");
const copyToolMenu = document.getElementById("copyToolMenu");
const copyControls = document.getElementById("copyControls");
const copyCountControl = document.getElementById("copyCountControl");
const copyCount = document.getElementById("copyCount");
const copyConfirm = document.getElementById("copyConfirm");
const copyClose = document.getElementById("copyClose");
const selectionActionLabel = document.getElementById("selectionActionLabel");
const selectionActionLabels = {
  move: "Сдвиг",
  "scale-selection": "Масштаб",
  rotate: "Поворот",
  mirror: "Зеркало",
  delete: "Удаление",
};
const maxCopiesPerPlacement = 1000;
const quickRotateTool = document.getElementById("quickRotateTool");
const quickMirrorTool = document.getElementById("quickMirrorTool");
const quickDeleteTool = document.getElementById("quickDeleteTool");
const gridStepSelect = document.getElementById("gridStepSelect");
const numericStepSelect = document.getElementById("numericStepSelect");
numericStepSelect.replaceChildren(...NUMERIC_STEPS.map(step => new Option(String(step).replace(".", ","), String(step))));
const gridVisibleReadout = document.getElementById("gridVisibleReadout");
const allSnapsButton = document.getElementById("allSnapsButton");
const snapMore = document.getElementById("snapMore");
const snapMoreSummary = snapMore.querySelector("summary");
const drawToolMenu = document.getElementById("drawToolMenu");
const blockPaletteButton = document.getElementById("blockPaletteButton");
const blockPaletteDialog = document.getElementById("blockPaletteDialog");
const blockPaletteList = document.getElementById("blockPaletteList");
const blockPaletteSearch = document.getElementById("blockPaletteSearch");
const blockPaletteSearchInput = document.getElementById("blockPaletteSearchInput");
const blockPaletteSearchToggle = document.getElementById("blockPaletteSearchToggle");
const blockPaletteSearchClear = document.getElementById("blockPaletteSearchClear");
const drawToolButtons = [...document.querySelectorAll("[data-draw-tool]")];
const dimensionToolMenu = createDimensionToolMenu();
const dimensionToolButtons = [...dimensionToolMenu.querySelectorAll("[data-dimension-tool]")];
const annotationToolMenu = createAnnotationToolMenu();
const annotationToolButtons = [...annotationToolMenu.querySelectorAll("[data-annotation-tool]")];
const revisionCloudControls = document.getElementById("revisionCloudControls");
const revisionCloudFinish = document.getElementById("revisionCloudFinish");
const traceControls = document.getElementById("traceControls");
const traceVisibilityButton = document.getElementById("traceVisibilityButton");
const traceEditButton = document.getElementById("traceEditButton");
const selectToolMenu = document.getElementById("selectToolMenu");
const selectModeMenu = createSelectModeMenu();
const selectionCommandButtons = [...selectToolMenu.querySelectorAll("[data-action]")];
const snaps = [...document.querySelectorAll("[data-snap]")];
const GRID_STEPS = [5, 10, 50, 100, 500, 1000];
const DEFAULT_VIEW_SCALE = 0.085;
const MIN_VIEW_SCALE = DEFAULT_VIEW_SCALE / 1000;
const MAX_VIEW_SCALE = 1.4;
const POLAR_STEPS = [5, 10, 15, 30, 45, 90];
const NEW_PROJECT_SNAPS = ["polar", "end", "mid", "center", "intersection", "perpendicular", "extension", "nearest"];
const NEW_PROJECT_POLAR_STEP = 15;
const snapSymbolPaths = {
  all: "M5 12h14M12 5v14M4 4h5M4 4v5M20 4h-5M20 4v5M4 20h5M4 20v-5M20 20h-5M20 20v-5",
  grid: "M6 6h12v12H6zM6 12h12M12 6v12",
  end: "M6 6h12v12H6z",
  mid: "M12 5l8 14H4z",
  center: "M19 12a7 7 0 1 1-14 0 7 7 0 0 1 14 0z",
  intersection: "M6 6l12 12M18 6L6 18",
  perpendicular: "M5 18h14M12 18V5",
  extension: "M4 20l7-7m2-2 2-2m2-2 3-3M17 4h3v3",
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
  "lineBreakControl", "lineEditApply", "linePolarStep",
  "lineEditOptions", "lineEditRadiusControl", "lineEditRadius", "lineEditForm",
  "lineLengthModes", "lineLengthInput", "lineEditCancel", "lineEditFinish", "lineEditSelective", "lineMirrorModes", "lineMirrorControl", "lineMirrorDelete",
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
const breakModeButtons = [...lineUi.lineBreakControl.querySelectorAll("button")];
const lineKeyboardInputs = [lineUi.lineLengthInput, lineUi.lineEditRadius];
const lineEditActions = new Set(["trim", "extend", "break", "join", "fillet", "scale"]);
const lineOnlyEditActions = new Set([...lineEditActions, "offset", "mirror"]);
const figureCutActions = new Set(["trim", "extend", "break"]);
const boundaryEditModes = new Set(["trim", "extend"]);
const boundaryEditPrompts = { trim: "Коснитесь участка для обрезки", extend: "Коснитесь конца для удлинения" };
const lineQuantityModes = {
  offset: [["distance", "Задать расстояние", "dimension"], ["through", "Провести через точку", "cursor"]],
  scale: [["factor", "Коэффициент", "scale"]],
};
const linePointEpsilon = 1e-6;
const lengthInput = document.getElementById("lengthInput");
const angleInput = document.getElementById("angleInput");
const inlineEditors = document.getElementById("inlineEditors");
const draftMetricLabels = document.getElementById("draftMetricLabels");
const draftMetricPair = draftMetricLabels.querySelector(".draft-metric-pair");
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
const annotationScaleButton = document.getElementById("annotationScaleButton");
const annotationScaleValue = document.getElementById("annotationScaleValue");
const annotationScaleSheet = document.getElementById("annotationScaleSheet");
const annotationScaleGrid = document.getElementById("annotationScaleGrid");
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
const spenIndicator = document.getElementById("spenIndicator");
const spenModeSheet = document.getElementById("spenModeSheet");
const spenInputModes = {
  auto: { label: "Авто", icon: "rotate", description: "Стилус распознаётся автоматически. Поднятие пера не меняет режим." },
  pen: { label: "Стилус", icon: "edit", description: "Перо чертит и выбирает. Палец перемещает вид, два пальца меняют масштаб." },
  finger: { label: "Палец", icon: "finger", description: "Обычное сенсорное управление с крестиком в центре экрана." },
};
const layersSheet = document.getElementById("layersSheet");
const layerActionsDialog = document.getElementById("layerActionsDialog");
const layerActionsList = document.getElementById("layerActionsList");
const addLineLayerButton = document.getElementById("addLineLayerButton");
const exportSheet = document.getElementById("exportSheet");
const layerList = document.getElementById("layerList");
const activeLayerStyle = document.getElementById("activeLayerStyle");
const exportCards = [...document.querySelectorAll(".export-card")];
const keyboardInputs = [lengthInput, angleInput, topLengthInput, topAngleInput, draftLengthInput, draftAngleInput].filter(Boolean);
let lastNumericInput = null;
let steppedMetricInput = null;
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
const trackingHoverDelayMs = 300;
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
  "arc-length": { icon: "⌒", label: "Длина дуги" },
  ordinate: { icon: "XY", label: "Коорд." },
  "jogged-radius": { icon: "↯", label: "Излом" },
  rotated: { icon: "⤢", label: "Под углом" },
  radial: { icon: "⌀", label: "Круг" },
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
    <button data-select-mode="lasso"><span data-line-icon="lasso" aria-hidden="true"></span><small>Лассо</small></button>
    <button data-select-mode="multi"><span data-line-icon="plus" aria-hidden="true"></span><small>Мульти</small></button>
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
    <button type="button" data-dimension-tool="aligned" aria-label="Размер по отрезку"><span aria-hidden="true">${cadIcon("dimension")}</span><small>По отрезку</small></button>
    <button type="button" data-dimension-tool="linear" aria-label="Размер по горизонтали или вертикали"><span aria-hidden="true">&#10231;</span><small>По оси</small></button>
    <button type="button" data-dimension-tool="angular" aria-label="Угол между сторонами"><span aria-hidden="true">${cadIcon("angle")}</span><small>Угол</small></button>
    <button type="button" data-dimension-tool="radial" aria-label="Размер круга"><span aria-hidden="true">${cadIcon("measureRadius")}</span><small>Круг</small></button>
    <button type="button" data-dimension-tool="chain" aria-label="Множественный размер"><span aria-hidden="true">↔↔</span><small>Цепочка</small></button>
    <button type="button" data-dimension-tool="arc-length" aria-label="Длина дуги"><span aria-hidden="true">${cadIcon("arc")}</span><small>Длина дуги</small></button>
    <button type="button" data-dimension-tool="ordinate" aria-label="Координатный размер"><span aria-hidden="true">XY</span><small>Коорд.</small></button>
    <button type="button" data-dimension-tool="jogged-radius" aria-label="Радиус с изломом"><span aria-hidden="true">↯</span><small>Излом</small></button>
    <button type="button" data-dimension-tool="rotated" aria-label="Размер под углом"><span aria-hidden="true">⤢</span><small>Под углом</small></button>
  `;
  document.querySelector(".workspace")?.append(menu);
  return menu;
}

function createAnnotationToolMenu() {
  const menu = document.createElement("div");
  menu.className = "draw-tool-menu bottom-tool-menu";
  menu.id = "annotationToolMenu";
  menu.setAttribute("role", "group");
  menu.setAttribute("aria-label", "Инструменты аннотации");
  menu.hidden = true;
  menu.innerHTML = `
    <button type="button" data-annotation-tool="text"><span aria-hidden="true">${cadIcon("text")}</span><small>Текст</small></button>
    <button type="button" data-annotation-tool="leader"><span aria-hidden="true">${cadIcon("edit")}</span><small>Выноска</small></button>
    <button type="button" data-annotation-tool="area"><span aria-hidden="true">${cadIcon("area")}</span><small>Площадь</small></button>
    <button type="button" data-annotation-tool="elevation"><span aria-hidden="true">${cadIcon("elevation")}</span><small>Высота Z</small></button>
    <button type="button" data-annotation-tool="revision-cloud" aria-label="Облако изменений" title="Облако изменений"><span aria-hidden="true">${cadIcon("revisionCloud")}</span><small>Облако</small></button>
    <button type="button" data-annotation-tool="trace"><span aria-hidden="true">${cadIcon("trace")}</span><small>Калька</small></button>
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
  [DEFAULT_LINE_LAYER]: { name: "Черновые" },
};
const defaultPlanLayers = [DEFAULT_LINE_LAYER, "dimensions", "text", "areas", "elevations"];
const TRACE_LAYER = "trace";
const traceTools = new Set(["select", "line", "polyline", "circle", "arc", "rectangle", "revision-cloud"]);
const lineLayerColors = ["#d05554", "#00857b", "#b37002", "#526fd0", "#b04d86", "#5c862e", "#af5a2d", "#3e8098"];

function projectDefaultLayers(project, customLineLayers) {
  const rooms = Array.isArray(project.survey?.rooms) ? project.survey.rooms : [];
  const hasLayer = (entities, layer) => Array.isArray(entities) && entities.some((entity) => entity?.layer === layer);
  const legacy = ["walls", "furniture"].filter((layer) => hasLayer(project.entities, layer) ||
    rooms.some((room) => hasLayer(room?.drawing?.entities, layer)));
  return [...defaultPlanLayers, ...legacy, ...customLineLayers.map(({ id }) => id)];
}

function drawingLayerInfo(id = DEFAULT_LINE_LAYER) {
  if (id === TRACE_LAYER) return { name: "Калька", color: "#996100" };
  const layer = Object.hasOwn(layerMeta, id) ? layerMeta[id] : state.customLineLayers.find((item) => item.id === id);
  if (!layer) return null;
  const result = { ...layer, ...(state.layerStyles[id] || {}) };
  if (id === DEFAULT_LINE_LAYER && !normalizeLineLayerColor(result.color)) {
    result.color = state.theme === "dark" ? "#d9e4f2" : "#26313d";
  }
  return result;
}

function lineWeightLabel(value) {
  return `${String(value).replace(".", ",")} мм`;
}

function lineTypeLabel(value) {
  return { solid: "Сплошная", dashed: "Штриховая", dotted: "Точечная" }[normalizeLineType(value) || DEFAULT_LINE_TYPE];
}

function lineTypeDash(value) {
  return { dashed: [10, 7], dotted: [2, 6] }[normalizeLineType(value)] || [];
}

function setLayerStyle(id, patch) {
  const next = { ...(state.layerStyles[id] || {}), ...patch };
  for (const key of Object.keys(next)) if (next[key] == null) delete next[key];
  if (Object.keys(next).length) state.layerStyles[id] = next;
  else delete state.layerStyles[id];
}

function isLayerLocked(id) {
  return state.lockedLayers.includes(id || DEFAULT_LINE_LAYER);
}

function availableLineLayerIds() {
  return [DEFAULT_LINE_LAYER, ...state.customLineLayers.map(({ id }) => id)].filter((id) => !isLayerLocked(id));
}

function canAssignEntityToLineLayer(entity) {
  return entity && entity.layer !== TRACE_LAYER && (isDraftLine(entity) || ["polyline", "rectangle", "circle", "arc"].includes(entity.type));
}

function layerLockMessage(id) {
  return id ? `Слой «${drawingLayerInfo(id)?.name || id}» заблокирован` : "Все слои для линий заблокированы";
}
let surveyPanel = null;
let surveyPointPicker = null;
const zoneLabelRects = new Map();
const homeThemeKey = "zamer.homeTheme";
const storedHomeTheme = apkReadJson(homeThemeKey, null);
let homeTheme = storedHomeTheme === "dark" || storedHomeTheme === "light" ? storedHomeTheme : null;
const spenSettingsKey = "zamer.spen.settings.v1";
let spenSettings = normalizeSpenSettings(apkReadJson(spenSettingsKey, null));
const spenRuntime = {
  supported: false,
  detected: false,
  active: false,
  hovering: false,
  nativeHover: false,
  contactId: null,
  point: null,
  lastHover: -Infinity,
  barrelDown: false,
  hoverExitAt: -Infinity,
  hoverExitTimer: null,
};

const state = {
  survey: normalizeSurvey(null),
  theme: "light",
  directManipulationIds: new Set(),
  tool: "select",
  revisionCloudMode: "rectangle",
  traceOptions: false,
  traceEditing: false,
  traceHistory: { undo: [], redo: [] },
  planZone: null,
  dimensionTool: "aligned",
  additionalDimensionDraft: null,
  ordinateAxis: "x",
  radialMode: "diameter",
  radialSource: null,
  circleMode: "center",
  angleMode: "draw",
  angleSide: null,
  annotationScale: 1,
  measurementSettings: normalizeMeasurementSettings(),
  tapZoomEnabled: true,
  selectTool: "select",
  selectionFilter: "all",

  view: {
    scale: DEFAULT_VIEW_SCALE,
    panX: 92,
    panY: 84,
  },
  drawing: null,
  quickMeasure: null,
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
  polarSnapLock: null,
  lastCursorPreview: null,
  dimensionPickCycle: null,
  selectionPickCycle: null,
  snapTracking: {
    points: [],
    hoverKey: null,
    hoverPoint: null,
    hoverTimer: null,
    active: null,
    compoundLock: null,
  },

  numericEdit: null,
  selectedId: null,
  selectedIds: [],
  selectedEndpoint: null,
  selectedFigureGrip: null,
  copyPicking: null,
  actionPicking: null,
  endpointEditBefore: null,
  selectionDrag: null,
  openEditMenuAfterPointer: false,
  undo: [],
  redo: [],
  snaps: new Set(NEW_PROJECT_SNAPS),
  snapsMuted: false,
  gridStep: 100,
  polarStep: NEW_PROJECT_POLAR_STEP,
  numericStep: 1,
  visibleLayers: new Set(defaultPlanLayers),
  customLineLayers: [],
  layerStyles: {},
  reusableBlocks: [],
  blockPlacement: null,
  lockedLayers: [],
  activeLineLayer: DEFAULT_LINE_LAYER,
  entities: [],
};

const TAP_MOVE_TOLERANCE = 8;
const LONG_PRESS_SELECT_MS = 430;
const DOUBLE_TAP_MS = 380;
const DOUBLE_TAP_DISTANCE = 20;
const SELECTION_CYCLE_DISTANCE = 12;
const TAP_ZOOM_INTERVAL_MS = 280;
const TAP_ZOOM_PIXELS_PER_DOUBLING = 110;
let pendingCanvasTap = null;
let tapZoom = null;

function spenModeEnabled() {
  return spenModeActive(spenSettings, spenRuntime);
}

function spenCursorActive() {
  return spenModeEnabled() && (spenRuntime.contactId !== null || (spenSettings.hoverCursor && spenRuntime.hovering)) && Boolean(spenRuntime.point);
}

function inputCursorScreen() {
  return spenCursorActive() ? spenRuntime.point : centerScreen();
}

function saveSpenSettings() {
  try { localStorage.setItem(spenSettingsKey, JSON.stringify(spenSettings)); } catch { /* optional device preference */ }
}

function syncSpenMode({ announce = false } = {}) {
  const active = spenModeEnabled();
  shell.classList.toggle("spen-mode", active);
  shell.classList.toggle("spen-compact-ui", active && spenSettings.compactUi);
  shell.dataset.inputMode = spenSettings.mode;
  shell.dataset.effectiveInputMode = active ? "pen" : "finger";
  const mode = spenInputModes[spenSettings.mode];
  const effectiveLabel = active ? "Стилус" : "Палец";
  const label = spenSettings.mode === "auto" ? `Авто · ${effectiveLabel}` : mode.label;
  spenIndicator.innerHTML = `${cadIcon(active ? "edit" : "finger")}<small>${mode.label}</small>`;
  spenIndicator.title = `Управление: ${label}`;
  spenIndicator.setAttribute("aria-label", `Режим управления: ${label}. Изменить`);
  spenIndicator.setAttribute("data-active", String(active));
  for (const button of spenModeSheet.querySelectorAll("[data-input-mode]")) {
    button.setAttribute("aria-pressed", String(button.dataset.inputMode === spenSettings.mode));
  }
  if (!active) {
    spenRuntime.hovering = false;
    spenRuntime.nativeHover = false;
    spenRuntime.point = null;
    spenRuntime.barrelDown = false;
  }
  if (announce && projectHome.hidden) {
    statusChip.textContent = active ? `${label} · перо чертит, палец перемещает вид` : `${label} · крестик в центре`;
  }
  draw();
}

function applySpenDeviceState(detail, options) {
  if (!detail || typeof detail !== "object") return;
  const wasActive = spenModeEnabled();
  spenRuntime.supported = detail.supported === true;
  spenRuntime.detected = detail.detected === true || spenRuntime.detected;
  if (typeof detail.active === "boolean") spenRuntime.active = detail.active;
  syncSpenMode({ announce: options?.announce && wasActive !== spenModeEnabled() });
}

function activateSpenMode() {
  const wasActive = spenModeEnabled();
  spenRuntime.supported = true;
  spenRuntime.detected = true;
  spenRuntime.active = true;
  if (wasActive !== spenModeEnabled()) syncSpenMode({ announce: true });
}

function activateSpenFromPointer(event) {
  if (event.pointerType !== "pen") return false;
  window.clearTimeout(spenRuntime.hoverExitTimer);
  activateSpenMode();
  spenRuntime.hovering = true;
  spenRuntime.point = getPointer(event);
  spenRuntime.lastHover = performance.now();
  return true;
}

window.addEventListener("zamer-spen-state", (event) => applySpenDeviceState(event.detail, { announce: true }));
window.setTimeout(() => {
  try {
    applySpenDeviceState(JSON.parse(window.ZamerAndroid?.spenState?.() || "null"));
  } catch { /* Browser and older APKs activate the mode from the first pen pointer. */ }
  syncSpenMode();
}, 0);

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
  localDbVersion: 4,
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

function projectEndpoint(projectId = persistence.projectId, clientId = persistence.clientId) {
  return `/api/projects/${encodeURIComponent(projectId)}?client=${encodeURIComponent(clientId)}`;
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

function projectIdentity(projectId = persistence.projectId, clientId = persistence.clientId) {
  return { clientId, projectId, endpoint: projectId ? projectEndpoint(projectId, clientId) : "", session: persistence.projectSession };
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
      if (!db.objectStoreNames.contains("google")) {
        const google = db.createObjectStore("google", { keyPath: ["owner", "id"] });
        google.createIndex("owner", "owner");
      }
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
    const preset = annotationScalePreset(state.annotationScale);
    const label = preset ? `1:${preset.denominator}` : "1:100";
    projectScaleCaption.textContent = persistence.projectId ? `${projectUnit(state.measurementSettings).label} · ${label}` : "Выберите файл";
  }
}

function syncInterfaceTheme() {
  const showingHome = !projectHome.hidden;
  const theme = showingHome ? (homeTheme ?? state.theme) : state.theme;
  const button = showingHome ? homeThemeButton : themeButton;
  const dark = theme === "dark";
  shell.dataset.theme = theme;
  button.setAttribute("aria-pressed", String(dark));
  button.title = dark ? "Включить светлую тему" : "Включить тёмную тему";
  button.firstElementChild.innerHTML = cadIcon(dark ? "sun" : "moon");
  document.querySelector('meta[name="theme-color"]').content = dark ? "#10141b" : "#f5f7fa";
  window.ZamerAndroid?.setTheme?.(theme);
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
  syncInterfaceTheme();
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

const googleSignInButton = document.getElementById("googleSignInButton");
const googleCloudStatus = document.getElementById("googleCloudStatus");
if (googleBridgeAvailable) document.getElementById("googleCloudRow").hidden = false;
const googleRequests = new Map();
let googleToken = null;
let googleSyncJob = null;
let googleSyncTimer = null;
let googleSignInBusy = false;
let googleReconnect = false;

window.zamerGoogleAuthorizationResult = (id, result) => {
  const request = googleRequests.get(id);
  if (!request) return;
  googleRequests.delete(id);
  window.clearTimeout(request.timer);
  if (typeof result?.token === "string" && result.token) request.resolve(result.token);
  else request.reject(new Error(result?.error || "Не удалось войти через Google"));
};

function authorizeGoogle(email, interactive) {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const timer = window.setTimeout(() => {
      googleRequests.delete(id);
      reject(new Error("Google не ответил. Повторите вход."));
    }, interactive ? 120000 : 18000);
    googleRequests.set(id, { resolve, reject, timer });
    try {
      window.ZamerAndroid.authorizeGoogle(id, email, interactive);
    } catch (error) {
      googleRequests.delete(id);
      window.clearTimeout(timer);
      reject(error);
    }
  });
}

async function googleProjectStates(owner) {
  const db = await openLocalProjectDb();
  const transaction = db.transaction("google", "readonly");
  const [entries] = await Promise.all([
    idbRequest(transaction.objectStore("google").index("owner").getAll(owner)), idbTransactionDone(transaction),
  ]);
  return Object.assign(Object.create(null), Object.fromEntries(entries.map((entry) => [entry.id, entry])));
}

async function writeGoogleProjectState(owner, id, fields) {
  const db = await openLocalProjectDb();
  const transaction = db.transaction("google", "readwrite");
  const store = transaction.objectStore("google");
  const completed = idbTransactionDone(transaction);
  completed.catch(() => {});
  const entry = { ...await idbRequest(store.get([owner, id])), ...fields, owner, id };
  store.put(entry);
  await completed;
  return entry;
}

async function tokenForGoogleAccount(account) {
  if (googleToken?.owner === account.id && Date.now() - googleToken.time < 40 * 60 * 1000) return googleToken.token;
  const token = await authorizeGoogle(account.login, false);
  const verified = await googleAccountForToken(token, nativeFetchDelegate);
  if (verified.id !== account.id || apkUser.id !== account.id) throw new Error("Подтвердите вход через Google");
  googleToken = { owner: account.id, token, time: Date.now() };
  return token;
}

async function importDeviceProjectsToGoogle(owner) {
  const migration = apkReadJson(googleMigrationKey, null);
  if (migration && (migration.owner !== owner || migration.complete)) return;
  localStorage.setItem(googleMigrationKey, JSON.stringify({ owner, complete: false }));
  for (const { id } of await apkListProjects(apkDeviceUser.id)) {
    if (await apkReadProject(id, owner) || (await apkArchivedProjectIds(owner)).has(id)) continue;
    const project = await apkReadProject(id, apkDeviceUser.id);
    if (project) await apkPersistProject({ ...project, clientId: owner, syncPending: false });
  }
  localStorage.setItem(googleMigrationKey, JSON.stringify({ owner, complete: true }));
}

function setGoogleCloudStatus(message) {
  googleCloudStatus.textContent = message;
}

function scheduleGoogleSync(owner = apkUser.id, delay = 4500) {
  if (!googleBridgeAvailable || owner !== apkUser.id || owner === apkDeviceUser.id) return;
  window.clearTimeout(googleSyncTimer);
  googleSyncTimer = window.setTimeout(() => {
    googleSyncTimer = null;
    void synchronizeGoogleAccount();
  }, delay);
}

async function synchronizeGoogleAccount() {
  const account = apkUser;
  const owner = account.id;
  if (!googleBridgeAvailable || owner === apkDeviceUser.id || googleSignInBusy) return;
  if (googleSyncJob) {
    scheduleGoogleSync(owner);
    return;
  }
  const active = () => apkUser.id === owner;
  const canReceive = () => active() && !projectHome.hidden;
  const task = (async () => {
    setGoogleCloudStatus("Синхронизирую чертежи…");
    const token = await tokenForGoogleAccount(account);
    if (!active()) return;
    const remote = googleDriveProjects(token, nativeFetchDelegate);
    const states = await googleProjectStates(owner);
    const writeState = async (id, fields) => { states[id] = await writeGoogleProjectState(owner, id, fields); };
    const local = {
      active, canReceive,
      list: () => apkListProjects(owner),
      load: async (id) => {
        const data = await apkReadProject(id, owner);
        return data ? { meta: apkProjectMeta(data), data } : null;
      },
      states: () => states,
      writeState,
      receive: async ({ id, record, conflict }, data, baseline) => {
        const request = persistence.openRequest;
        const stillHome = () => canReceive() && request === persistence.openRequest;
        const current = await apkReadProject(id, owner);
        const archived = (await apkArchivedProjectIds(owner)).has(id);
        if (!stillHome()) return;
        if (!archived && current && driveProjectStamp(apkProjectMeta(current)) !== baseline.stamp) return;
        // A live branch arriving after a local deletion is preserved as a separate copy.
        if (!record.deleted && archived) {
          id = `cloud-${record.id}`.slice(0, 80);
          conflict = true;
          if (states[id]?.fileId === record.id || (await apkArchivedProjectIds(owner)).has(id) || await apkReadProject(id, owner)) return;
          if (!stillHome()) return;
        }
        let stamp = "deleted";
        if (record.deleted) {
          if (current && !archived) await apkArchiveProject(current, projectIdentity(id, owner));
        } else {
          validateZamerProject(data);
          if (data.projectId !== record.projectId) throw new Error("Повреждён идентификатор чертежа в Google Диске");
          const suffix = conflict ? " · копия" : "";
          const name = String(data.name || "Чертёж").slice(0, 80 - suffix.length) + suffix;
          const revision = Math.max(1, projectRevision(data), projectRevision(current) + 1);
          const now = new Date().toISOString();
          const project = { ...data, name, projectId: id, clientId: owner, revision, baseRevision: revision,
            updatedAt: now, savedAt: now, serverSavedAt: now, syncPending: false };
          if (!(await saveProjectToLocalStore(project, "google-drive", projectIdentity(id, owner)))) {
            throw new Error("Не удалось записать чертёж из Google Диска на телефон");
          }
          await apkPersistProject(project);
          stamp = driveProjectStamp(apkProjectMeta(project));
        }
        await writeState(id, { stamp, fileId: record.id, groupId: record.projectId, remove: false, pending: null });
      },
    };
    await syncDriveProjects(local, remote);
    if (!active()) return;
    googleReconnect = false;
    renderAuthUi();
    setGoogleCloudStatus("Чертежи синхронизированы");
    if (canReceive()) await loadProjects();
    if (persistence.ready && !persistence.dirty && persistence.projectId) {
      const saved = await apkReadProject(persistence.projectId, owner);
      if (active() && saved && saved.projectId === persistence.projectId && !persistence.dirty &&
          states[saved.projectId]?.stamp === driveProjectStamp(apkProjectMeta(saved))) {
        updateSaveIndicator("saved", "В Google Диске", { autoDim: 2400 });
      }
    }
  })();
  googleSyncJob = task;
  try {
    await task;
  } catch (error) {
    if (!active()) return;
    if (error.status === 401) googleToken = null;
    googleReconnect = !googleToken || error.status === 401;
    setGoogleCloudStatus(navigator.onLine ? error.message || "Облако недоступно" : "Без сети · чертежи на телефоне");
    renderAuthUi();
  } finally {
    if (googleSyncJob === task) googleSyncJob = null;
    if (active() && googleSyncTimer === null) scheduleGoogleSync(owner, 45000);
  }
}

async function signInWithGoogle() {
  if (!googleBridgeAvailable || googleSignInBusy) return;
  googleSignInBusy = true;
  renderAuthUi();
  setGoogleCloudStatus("Открываю вход Google…");
  try {
    const token = await authorizeGoogle("", true);
    const account = await googleAccountForToken(token, nativeFetchDelegate);
    await googleDriveProjects(token, nativeFetchDelegate).list();
    if (!(await saveProjectBeforeLeaving())) throw new Error("Не удалось сохранить открытый чертёж");
    await importDeviceProjectsToGoogle(account.id);
    localStorage.setItem(googleAccountKey, JSON.stringify(account));
    googleToken = { owner: account.id, token, time: Date.now() };
    googleReconnect = false;
    if (apkUser.id !== account.id) {
      apkUser = account;
      setAuthenticatedUser(account);
      resetProjectSession();
      await initProjectHome();
    }
    scheduleGoogleSync(account.id, 0);
  } catch (error) {
    setGoogleCloudStatus(error.message || "Не удалось войти через Google");
  } finally {
    googleSignInBusy = false;
    renderAuthUi();
  }
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
    accountBadge.hidden = !authState.user || (nativeApkMode && authState.user.id === apkDeviceUser.id);
    accountBadge.textContent = authState.user?.login || "";
  }
  if (logoutButton) logoutButton.hidden = !authState.user || (nativeApkMode && authState.user.id === apkDeviceUser.id);
  if (googleBridgeAvailable) {
    googleSignInButton.hidden = apkUser.id !== apkDeviceUser.id && !googleReconnect;
    googleSignInButton.disabled = googleSignInBusy;
    googleSignInButton.textContent = googleReconnect ? "Подключить Google снова" : "Войти через Google";
  }
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
  state.quickMeasure = null;
  syncQuickMeasure();
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
      scheduleGoogleSync(apkUser.id, 0);
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
  if (nativeApkMode) {
    if (googleSignInBusy) return;
    localStorage.removeItem(googleAccountKey);
    window.clearTimeout(googleSyncTimer);
    googleSyncTimer = null;
    googleToken = null;
    googleReconnect = false;
    apkUser = apkDeviceUser;
    setAuthenticatedUser(apkUser);
    resetProjectSession();
    setGoogleCloudStatus("");
    await initProjectHome();
    return;
  }
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
    const primary = apkReadJson(apkProjectKey(identity.projectId, identity.clientId), null);
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
    if (!showingTrash) {
      const icon = document.createElement("span");
      icon.className = "project-card-open-icon";
      icon.innerHTML = cadIcon("openFolder");
      open.append(icon);
    }

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

function showProjectDialog({ title, message = "", value = "", placeholder = "", inputLabel = "Название проекта", inputType = "text", confirmText = "Готово", destructive = false, withInput = true, choices = [], maxLength = 80, validateValue }) {
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
      if ([...input.options].some((option) => option.value === String(value))) input.value = String(value);
      dialog.append(input);
    } else if (withInput) {
      input = document.createElement("input");
      input.type = inputType;
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
      window.setTimeout(processNativeImports, 0);
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

function showImportSettingsDialog({ name, displayUnit = "mm" }) {
  return new Promise((resolve) => {
    closeProjectDialog?.(null);
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const background = [...shell.children].map((element) => [element, element.inert]);
    const backdrop = document.createElement("div");
    backdrop.className = "project-dialog-backdrop";
    const dialog = document.createElement("form");
    dialog.className = "project-dialog import-settings-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "importSettingsTitle");

    const heading = document.createElement("strong");
    heading.id = "importSettingsTitle";
    heading.textContent = "Настройки импорта";
    const description = document.createElement("p");
    description.id = "importSettingsDescription";
    description.textContent = "Выберите единицы координат в исходном файле. Внутри Zamer CAD геометрия хранится в миллиметрах.";
    dialog.setAttribute("aria-describedby", description.id);

    function field(label, control) {
      const wrapper = document.createElement("label");
      wrapper.className = "project-dialog-field";
      const caption = document.createElement("span");
      caption.textContent = label;
      wrapper.append(caption, control);
      return wrapper;
    }

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.value = name;
    nameInput.maxLength = 80;
    nameInput.required = true;
    nameInput.autocomplete = "off";

    const sourceUnit = document.createElement("select");
    sourceUnit.add(new Option("Миллиметры — ×1", "mm"));
    sourceUnit.add(new Option("Сантиметры — ×10", "cm"));
    sourceUnit.add(new Option("Метры — ×1000", "m"));
    sourceUnit.add(new Option("Другой коэффициент", "custom"));

    const factorInput = document.createElement("input");
    factorInput.type = "text";
    factorInput.inputMode = "decimal";
    factorInput.value = "1";
    factorInput.maxLength = 12;
    factorInput.required = true;

    const resultUnit = document.createElement("select");
    resultUnit.add(new Option("Миллиметры", "mm"));
    resultUnit.add(new Option("Сантиметры", "cm"));
    resultUnit.add(new Option("Метры", "m"));
    resultUnit.value = Object.hasOwn(IMPORT_UNIT_FACTORS, displayUnit) ? displayUnit : "mm";

    const hint = document.createElement("p");
    hint.className = "import-scale-hint";
    const updateHint = () => {
      const factor = Number(factorInput.value.replace(",", "."));
      hint.textContent = Number.isFinite(factor)
        ? `Все длины и координаты будут умножены на ${String(factor).replace(".", ",")}.`
        : "Введите числовой коэффициент.";
    };
    sourceUnit.addEventListener("change", () => {
      factorInput.setCustomValidity("");
      if (Object.hasOwn(IMPORT_UNIT_FACTORS, sourceUnit.value)) factorInput.value = String(IMPORT_UNIT_FACTORS[sourceUnit.value]);
      factorInput.readOnly = sourceUnit.value !== "custom";
      if (sourceUnit.value === "custom") factorInput.focus();
      updateHint();
    });
    factorInput.addEventListener("input", () => {
      sourceUnit.value = "custom";
      factorInput.readOnly = false;
      factorInput.setCustomValidity("");
      updateHint();
    });
    factorInput.readOnly = true;
    updateHint();

    const actions = document.createElement("div");
    actions.className = "project-dialog-actions";
    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.textContent = "Отмена";
    const confirmButton = document.createElement("button");
    confirmButton.type = "submit";
    confirmButton.className = "primary";
    confirmButton.textContent = "Импортировать";
    actions.append(cancelButton, confirmButton);
    dialog.append(heading, description, field("Название проекта", nameInput), field("Единицы в файле", sourceUnit),
      field("Коэффициент", factorInput), hint, field("Показывать размеры", resultUnit), actions);
    backdrop.append(dialog);

    const finish = (result) => {
      closeProjectDialog = null;
      backdrop.remove();
      for (const [element, inert] of background) element.inert = inert;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
      updateViewportLock();
      resolve(result);
      window.setTimeout(processNativeImports, 0);
    };
    closeProjectDialog = finish;
    cancelButton.addEventListener("click", () => finish(null));
    backdrop.addEventListener("pointerdown", (event) => {
      if (event.target === backdrop) finish(null);
    });
    dialog.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        finish(null);
      }
    });
    dialog.addEventListener("submit", (event) => {
      event.preventDefault();
      const projectName = nameInput.value.trim().slice(0, 80);
      const factor = Number(factorInput.value.replace(",", "."));
      if (!projectName) return nameInput.focus();
      if (!Number.isFinite(factor) || factor < 0.001 || factor > 1000) {
        factorInput.setCustomValidity("Введите коэффициент от 0,001 до 1000");
        factorInput.reportValidity();
        return;
      }
      finish({ name: projectName, factor, sourceUnit: sourceUnit.value, displayUnit: resultUnit.value });
    });
    for (const [element] of background) element.inert = true;
    shell.append(backdrop);
    requestAnimationFrame(() => sourceUnit.focus());
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
  if (!state.drawing) centerOpeningView();
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

const pendingNativeImports = [];
const pendingNativeImportIds = new Set();
let nativeImportBusy = false;
let projectImportBusy = false;

window.zamerReceiveFile = (message) => {
  if (!message?.id || pendingNativeImportIds.has(message.id)) return;
  pendingNativeImportIds.add(message.id);
  pendingNativeImports.push(message);
  void processNativeImports();
};

async function processNativeImports() {
  if (nativeImportBusy || projectImportBusy || closeProjectDialog || !authState.user || !authScreen.hidden ||
      state.leaderInput || document.querySelector("dialog[open]")) return;
  const message = pendingNativeImports.shift();
  if (!message) return;
  nativeImportBusy = true;
  try {
    const file = await readNativeImportFile(message);
    if (projectHome.hidden) await showProjectHome();
    if (projectHome.hidden) throw new Error("Не удалось сохранить текущий проект. Новый файл не открыт.");
    await importProjectFile(file);
  } catch (error) {
    console.warn("Open Android file failed", error);
    showProjectMessage(error.message || "Не удалось открыть файл", true);
    if (projectHome.hidden) statusChip.textContent = error.message || "Не удалось открыть файл";
  } finally {
    pendingNativeImportIds.delete(message.id);
    nativeImportBusy = false;
    window.ZamerAndroid?.completeFileImport?.(message.id);
    void processNativeImports();
  }
}

document.addEventListener("close", () => void processNativeImports(), true);

async function importProjectFile(file) {
  if (!file) return;
  if (projectImportBusy) throw new Error("Дождитесь открытия предыдущего файла");
  projectImportBusy = true;
  try {
    await importProjectFileContent(file);
  } finally {
    projectImportBusy = false;
    void processNativeImports();
  }
}

async function importProjectFileContent(file) {
  if (!file) return;
  projectImportInput.value = "";
  if (!file.size || file.size > MAX_ZAMER_FILE_BYTES) throw new Error("Выберите непустой ZAMER, DWG или DXF размером до 32 МБ");
  const extension = file.name.split(".").at(-1).toLowerCase();
  if (!["zamer", "json", "dwg", "dxf"].includes(extension)) throw new Error("Выберите чертёж в формате ZAMER, DWG или DXF");
  const fileName = file.name.replace(/\.[^.]+$/, "").slice(0, 80) || "Импорт";
  const cad = extension === "dwg" || extension === "dxf";
  let project;
  let skipped = 0;
  if (cad) {
    showProjectMessage("Открываю чертёж…");
    let bytes = await file.arrayBuffer();
    if (extension === "dwg") {
      const { dwgToDxf } = await import("./core/dwg.js");
      bytes = await dwgToDxf(bytes);
    }
    ({ project, skipped } = importDxf(bytes, fileName));
    project.theme = shell.dataset.theme;
  } else {
    try { project = JSON.parse((await file.text()).replace(/^\uFEFF/, "")); }
    catch { throw new Error("Файл .zamer повреждён"); }
  }
  validateZamerProject(project);
  showProjectMessage();
  if (cad) {
    const name = await showProjectDialog({
      title: "Название импортируемого проекта", value: project.name || fileName, inputLabel: "Название проекта",
      confirmText: "Импортировать", message: [
        "Это импорт в проект Замера. Полное сохранение исходного DWG/DXF при обратном экспорте пока не поддерживается.",
        skipped ? `Пропущено объектов, которые Zamer не смог открыть — ${skipped}.` : "",
      ].filter(Boolean).join("\n"),
    });
    if (!name) return;
    await createProject({ name, project });
    if (projectHome.hidden) {
      fitViewport();
      statusChip.textContent = skipped ? `Открыто ${project.entities.length} · пропущено ${skipped}` : `Открыт чертёж ${extension.toUpperCase()}`;
    }
    return;
  }
  const settings = await showImportSettingsDialog({ name: project.name || fileName, displayUnit: project.measurementSettings?.unit });
  if (!settings) return;
  if (settings.factor !== 1) project = scaleImportedProject(project, settings.factor);
  project.measurementSettings = { ...project.measurementSettings, unit: settings.displayUnit };
  validateZamerProject(project);
  await createProject({ name: settings.name, project });
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
  if (state.quickMeasure) setTool("select");
  setProjectHomeVisible(true);
  updateSaveIndicator("idle", "Выберите файл");
  await loadProjects();
  if (!projectHome.hidden) (projectCardButton(persistence.projectId) || createBlankProjectButton)?.focus({ preventScroll: true });
  scheduleGoogleSync(apkUser.id, 0);
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
  void processNativeImports();
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
    numericStep: state.numericStep,
    visibleLayers: [...state.visibleLayers],
    ...(state.customLineLayers.length ? { customLineLayers: state.customLineLayers, activeLineLayer: state.activeLineLayer } : {}),
    ...(Object.keys(state.layerStyles).length ? { layerStyles: state.layerStyles } : {}),
    ...(state.lockedLayers.length ? { lockedLayers: state.lockedLayers } : {}),
    annotationLayers: 1,
    annotationScale: state.annotationScale,
    measurementSettings: { ...state.measurementSettings },
    tapZoomEnabled: state.tapZoomEnabled,
    survey: state.survey,
    draft: acceptedSurveyDraft(),
    ...(state.reusableBlocks.length ? { reusableBlocks: state.reusableBlocks } : {}),

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
    (!isReusableBlock(entity) || expandReusableBlock(entity)) &&
    (entity.type !== "polyline" || validPolylinePoints(entity.points, entity.closed, entity.bulges)));
}

function cloneProjectEntity(entity) {
  try {
    const copy = JSON.parse(JSON.stringify(entity));
    if (isPlanAnnotationZone(copy)) {
      const normalized = normalizePlanAnnotation(copy);
      if (normalized && copy.groupId) normalized.groupId = copy.groupId;
      return normalized;
    }
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
    state.quickMeasure = null;
    state.reusableBlocks = normalizeReusableBlocks(project.reusableBlocks);
    state.blockPlacement = null;
    state.survey = normalizeSurvey(project.survey);
    state.planZone = null;
    surveyPointPicker = null;
    surveyPanel?.close();
    if (planAnnotationEditor.open) planAnnotationEditor.close();
    if (blockPaletteDialog.open) blockPaletteDialog.close();
    if (project.view && Number.isFinite(project.view.scale)) {
      state.view.scale = clampScale(project.view.scale);
      state.view.panX = Number.isFinite(project.view.panX) ? project.view.panX : state.view.panX;
      state.view.panY = Number.isFinite(project.view.panY) ? project.view.panY : state.view.panY;
    }
    state.snaps = normalizeDirectionalSnapModes(Array.isArray(project.snaps) ? project.snaps : ["grid", "end", "polar"]);
    state.snapsMuted = false;
    state.gridStep = GRID_STEPS.includes(project.gridStep) ? project.gridStep : 100;
    state.polarStep = POLAR_STEPS.includes(project.polarStep) ? project.polarStep : 5;
    state.numericStep = normalizeNumericStep(project.numericStep);
    Object.assign(state, normalizeLineLayerSettings(project));
    const availableLayers = new Set(projectDefaultLayers(project, state.customLineLayers));
    if ((Array.isArray(project.visibleLayers) && project.visibleLayers.includes(TRACE_LAYER)) ||
        restoredEntities.some((entity) => entity.layer === TRACE_LAYER)) {
      availableLayers.add(TRACE_LAYER);
    }
    state.visibleLayers = new Set((Array.isArray(project.visibleLayers) ? project.visibleLayers : [...availableLayers])
      .filter((id) => availableLayers.has(id)));
    if (isLayerLocked(state.activeLineLayer)) resetActiveLineLayer();
    if (project.annotationLayers !== 1) {
      state.visibleLayers.add("areas");
      state.visibleLayers.add("elevations");
      if (state.visibleLayers.has("dimensions")) state.visibleLayers.add("text");
    }
    state.measurementSettings = normalizeMeasurementSettings(project.measurementSettings);
    state.tapZoomEnabled = project.tapZoomEnabled !== false;
    setAnnotationScale(project.annotationScale, { save: false });
    exportScale.value = state.measurementSettings.printScale;
    if (project.theme === "light" || project.theme === "dark") {
      state.theme = project.theme;
    }
    state.selectionFilter = selectionFilterForProject(project.selectionFilter);

    state.drawing = null;
    closeLeaderInput();
    state.moveCommand = null;
    state.offsetCommand = null;
    state.lineEdit = null;
    state.dimensionAttach = null;
    closeLineMetricInput();
    cancelPendingCanvasTap();
    tapZoom = null;
    state.pointer = null;
    state.lastAnnotationTap = null;
    state.pinch = null;
    state.inlineEdit = null;
    state.numericEdit = null;
    steppedMetricInput = null;
    state.selectionDrag = null;
    state.copyPicking = null;
    state.actionPicking = null;
    copyToolMenu.hidden = true;
    state.selectedFigureGrip = null;
    state.selectedEndpoint = null;
    state.endpointEditBefore = null;
    state.undo = [];
    state.redo = [];
    resetTrace();
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
    if (!persistence.dirty) updateSaveIndicator("saved", nativeApkMode && identity.clientId !== apkDeviceUser.id ? "На телефоне" : "Сохранено", { autoDim: 2400 });
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
  return Boolean(numericConfirmInput(false)) || lineKeyboardInputs.includes(active) ||
    active === leaderUi.text || active === leaderUi.height || active === circleTangentRadius ||
    active === projectSearchInput ||
    Boolean(active?.matches(".survey-sheet :is(input, textarea, select), .viewport-objects-dialog input, .project-dialog input"));
}

function numericConfirmInput(includeStepper = true) {
  if (includeStepper && steppedMetricInput && !steppedMetricInput.closest("[hidden]")) return steppedMetricInput;
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
  const draftingInput = Boolean(numericConfirmInput(false));
  const nativeImeVisible = androidKeyboardViewport?.visible === true;
  const rawInset = visualViewport ? Math.max(0, layoutHeight - visualViewport.height - visualViewport.offsetTop) : 0;
  const heightLoss = Math.max(0, stableViewportHeight - viewportHeight);
  const nativeInset = nativeImeVisible && androidKeyboardViewport.availableHeight > 0
    ? Math.max(0, stableViewportHeight - androidKeyboardViewport.availableHeight) : 0;
  const detectedInset = Math.max(rawInset, heightLoss, nativeInset);
  const maximumInset = Math.max(0, stableViewportHeight - (draftingInput ? 0 : 240));
  const keyboardInset = inputFocused && (nativeImeVisible || detectedInset > 80) ? Math.min(detectedInset, maximumInset) : 0;
  draftingKeyboardInset = keyboardInset;

  if (!inputFocused && !nativeImeVisible) {
    // System-bar insets and split-screen can shrink the viewport after startup.
    // Only hold its previous height while an input actually owns the keyboard.
    stableViewportHeight = Math.max(viewportHeight, layoutHeight);
  } else if (keyboardInset === 0) {
    stableViewportHeight = Math.max(stableViewportHeight, viewportHeight, layoutHeight);
  }

  const rootStyle = document.documentElement.style;
  const draftingKeyboard = draftingInput && keyboardInset > 0;
  const viewportTop = draftingKeyboard ? Math.max(0, visualViewport?.offsetTop || 0) : 0;
  rootStyle.setProperty("--app-height", `${stableViewportHeight}px`);
  rootStyle.setProperty("--keyboard-inset", `${Math.round(keyboardInset)}px`);
  rootStyle.setProperty("--quick-edit-row-height", stableViewportHeight <= 760 ? "44px" : "52px");
  rootStyle.setProperty("--drafting-viewport-top", `${viewportTop}px`);
  shell.classList.toggle("keyboard-open", keyboardInset > 0);
  const workspaceTop = draftingKeyboard ? canvas.getBoundingClientRect().top - viewportTop : 0;
  shell.classList.toggle("drafting-keyboard-compact", draftingKeyboard && stableViewportHeight - keyboardInset - workspaceTop < 128);
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
  return screenToWorld(inputCursorScreen());
}

function syncViewportCoordinates(rect) {
  const { x, y } = screenToWorld(spenCursorActive() ? spenRuntime.point : { x: rect.width / 2, y: rect.height / 2 });
  const settings = state.measurementSettings;
  const xLabel = `X ${formatProjectLength(x, settings, { suffix: false })}`;
  const yLabel = `Y ${formatProjectLength(-y, settings, { suffix: false })}`;
  const unit = projectUnit(settings).label;
  if (cursorCoordinateX.textContent === xLabel && cursorCoordinateY.textContent === yLabel &&
      cursorCoordinateUnit.textContent === unit) return;
  cursorCoordinateX.textContent = xLabel;
  cursorCoordinateY.textContent = yLabel;
  cursorCoordinateUnit.textContent = unit;
  viewportCoordinates.setAttribute("aria-label", `К началу координат · ${xLabel} · ${yLabel} ${unit}`);
}

function quickMeasureContour(mode) {
  return mode === "area" || mode === "perimeter";
}

function quickMeasureClosesContour(mode, points, point) {
  return quickMeasureContour(mode) && points.length >= 3 &&
    distanceWorld(point, points[0]) * state.view.scale <= screenUiPx(14);
}

function configureQuickMeasure(mode, method = mode === "radius" ? "existing" : "points") {
  state.quickMeasure = { mode, method, points: [], measurement: null, error: "" };
  resetSnapTracking();
  draw();
}

function quickMeasureSnap(raw) {
  const { mode, method, points, measurement } = state.quickMeasure;
  if (method === "existing") {
    state.snapTracking.active = null;
    state.polarSnapGuide = null;
    return { point: raw, snap: null };
  }
  if (!measurement && quickMeasureClosesContour(mode, points, raw)) {
    const first = points[0];
    state.snapTracking.active = null;
    state.polarSnapGuide = null;
    return { point: first, snap: { ...first, type: "end" } };
  }
  // The completed result stays visible while the cursor is ready for a fresh first point.
  const start = measurement ? null : (mode === "angle" ? points[0] : points.at(-1));
  return resolveDimensionPointSnap(raw, { start });
}

function quickMeasureFromPoints(mode, points) {
  const [first, second, third] = points;
  const result = { points, value: null, closed: false };
  if (!second) return result;
  if (mode === "distance") return { ...result, value: distanceWorld(first, second) };
  if (mode === "angle" && third) {
    const angle = angularDimensionGeometry({ vertex: first, arm1: second, arm2: third });
    return { ...result, angle, value: angle?.measurement ?? null };
  }
  if (mode === "radius" && third) {
    const circle = arcGeometry(first, second, third);
    if (circle && isLinePoint(circle.center) && circle.radius <= MAX_LINE_COORDINATE) return { ...result, circle, value: circle.radius };
  }
  if (quickMeasureContour(mode) && third) {
    let area = 0;
    let perimeter = 0;
    for (const [index, a] of points.entries()) {
      const b = points[(index + 1) % points.length];
      area += (a.x - first.x) * (b.y - first.y) - (b.x - first.x) * (a.y - first.y);
      perimeter += distanceWorld(a, b);
    }
    return { ...result, closed: true, value: mode === "area" ? Math.abs(area) / 2e6 : perimeter };
  }
  return result;
}

function quickMeasureFromPlan(mode) {
  if (mode === "radius") {
    const hit = pickDimensionCurve(inputCursorScreen(), true, true);
    if (!hit) return null;
    const circle = hit.arc ? arcGeometry(hit.arc.start, hit.arc.through, hit.arc.end) :
      { center: { x: hit.entity.cx, y: hit.entity.cy }, radius: Math.abs(hit.entity.radius) };
    return circle && isLinePoint(circle.center) && Number.isFinite(circle.radius) && circle.radius > 0
      ? { circle, points: [hit.point], value: circle.radius } : null;
  }
  const contour = planContourAt(rawCursorWorld(), { retainCurves: true });
  if (!contour) return null;
  const { entity, points } = contour;
  if (entity?.type === "circle") {
    const { cx, cy, radius } = entity;
    const circle = { center: { x: cx, y: cy }, radius };
    return { circle, points, value: mode === "area" ? Math.PI * radius ** 2 / 1e6 : 2 * Math.PI * radius };
  }
  const result = quickMeasureFromPoints(mode, points);
  if (entity?.type === "polyline" && entity.bulges?.some(Boolean)) {
    const exact = measureSurveyContour(entity);
    if (!exact.error) result.value = mode === "area" ? exact.areaM2 : exact.perimeterM * 1000;
  }
  return result;
}

function quickMeasureAtCursor(measure) {
  if (measure.measurement) return measure.measurement;
  if (measure.method === "existing") return quickMeasureFromPlan(measure.mode);
  if (!measure.points.length) return null;
  const point = cursorWorld();
  const extendsDraft = isLinePoint(point) && !measure.points.some((item) => distanceWorld(item, point) <= linePointEpsilon);
  return quickMeasureFromPoints(measure.mode, extendsDraft ? [...measure.points, point] : measure.points);
}

function quickMeasureLabel(mode, value) {
  if (!Number.isFinite(value)) return "";
  if (mode === "area") return formatProjectArea(value, state.measurementSettings);
  if (mode === "angle") return formatProjectAngle(value, state.measurementSettings);
  return projectLength(value);
}

function quickMeasureHint(measure) {
  if (measure.measurement) return "";
  if (measure.error) return measure.error;
  if (measure.method === "existing") return measure.mode === "radius" ? "Наведите крестик на круг или дугу" : "Наведите крестик внутрь замкнутой области";
  const count = measure.points.length;
  if (measure.mode === "angle") return ["Укажите вершину угла", "Укажите первую сторону", "Укажите вторую сторону"][count];
  if (measure.mode === "radius") return ["Укажите первую точку дуги", "Укажите вторую точку дуги", "Укажите третью точку дуги"][count];
  if (quickMeasureContour(measure.mode)) return count >= 3 ? "Для замыкания укажите первую точку" : "Укажите точку контура";
  return count ? "Укажите вторую точку" : "Укажите первую точку";
}

function syncQuickMeasure(preview = null) {
  const measure = state.quickMeasure;
  const { button, panel, method, finish, value, hint, result } = quickMeasureUi;
  panel.hidden = !measure;
  button.classList.toggle("active", Boolean(measure));
  button.setAttribute("aria-expanded", String(Boolean(measure)));
  button.setAttribute("aria-pressed", String(Boolean(measure)));
  if (!measure) {
    value.hidden = true;
    if (value.textContent) value.textContent = "";
    if (result.textContent) result.textContent = "";
    return;
  }
  const selectedMode = quickMeasureModeButtons.find((option) => option.dataset.measureMode === measure.mode);
  for (const option of quickMeasureModeButtons) {
    const pressed = String(option === selectedMode);
    if (option.getAttribute("aria-pressed") !== pressed) option.setAttribute("aria-pressed", pressed);
  }
  method.hidden = measure.mode !== "radius" && !quickMeasureContour(measure.mode);
  for (const option of quickMeasureMethodButtons) {
    const pressed = String(option.dataset.measureMethod === measure.method);
    if (option.getAttribute("aria-pressed") !== pressed) option.setAttribute("aria-pressed", pressed);
  }
  finish.hidden = Boolean(measure.measurement) || measure.method !== "points" || !quickMeasureContour(measure.mode) || measure.points.length < 3;
  const label = quickMeasureLabel(measure.mode, preview?.value);
  value.hidden = !label;
  if (value.textContent !== label) value.textContent = label;
  const message = quickMeasureHint(measure);
  if (hint.textContent !== message) hint.textContent = message;
  const announcement = measure.measurement ? `${selectedMode.querySelector("small").textContent} ${label}` : "";
  if (result.textContent !== announcement) result.textContent = announcement;
}

function quickMeasureEdgeAnchor(start, end, { halfWidth, halfHeight }) {
  const center = midpoint(start, end);
  const normal = normalizeScreenVector(end.y - start.y, start.x - end.x, 0, -1);
  const side = normal.y > 0 || (normal.y === 0 && normal.x < 0) ? -1 : 1;
  const offset = 4 + Math.abs(normal.x) * halfWidth + Math.abs(normal.y) * halfHeight;
  return { x: center.x + normal.x * offset * side, y: center.y + normal.y * offset * side };
}

function positionQuickMeasureValue(anchor, size, viewport) {
  const { panel, value } = quickMeasureUi;
  if (!anchor || value.hidden) return;
  const { left, right, top, bottom } = panel.getBoundingClientRect();
  const controls = {
    left: left - viewport.left - 3, right: right - viewport.left + 3,
    top: top - viewport.top - 3, bottom: bottom - viewport.top + 3,
  };
  const { x, y } = draftMetricPosition(anchor, size, viewport, null, controls);
  value.style.left = `${x}px`;
  value.style.top = `${y}px`;
}

function drawQuickMeasure(c, viewport) {
  const measure = state.quickMeasure;
  const preview = measure ? quickMeasureAtCursor(measure) : null;
  syncQuickMeasure(preview);
  if (!preview) return;
  const { value } = quickMeasureUi;
  const size = { halfWidth: value.offsetWidth / 2, halfHeight: value.offsetHeight / 2 };
  const points = preview.points.map(worldToScreen);
  let anchor;
  ctx.save();
  ctx.strokeStyle = c.accent2;
  ctx.fillStyle = c.accent2;
  ctx.lineWidth = 2;
  if (!measure.measurement) ctx.setLineDash([7, 5]);
  if (preview.circle) {
    const { center, radius } = preview.circle;
    const screen = worldToScreen(center);
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, radius * state.view.scale, 0, 2 * Math.PI);
    ctx.stroke();
    if (measure.mode === "radius") {
      const rim = points.at(-1);
      linePath(screen.x, screen.y, rim.x, rim.y);
      anchor = quickMeasureEdgeAnchor(screen, rim, size);
    } else {
      anchor = measure.mode === "area" ? screen : { x: screen.x, y: screen.y - radius * state.view.scale - 12 };
    }
  } else if (points.length > 1) {
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    ctx.lineTo(points[1].x, points[1].y);
    if (measure.mode === "angle" && points[2]) {
      ctx.moveTo(points[0].x, points[0].y);
      ctx.lineTo(points[2].x, points[2].y);
    } else {
      for (const point of points.slice(2)) ctx.lineTo(point.x, point.y);
      if (preview.closed) ctx.closePath();
    }
    ctx.stroke();
    if (preview.angle) {
      const { startAngle, sweep } = preview.angle;
      const radius = Math.min(30, distanceWorld(points[0], points[1]) * .45, distanceWorld(points[0], points[2]) * .45);
      ctx.beginPath();
      ctx.arc(points[0].x, points[0].y, radius, startAngle, startAngle + sweep, sweep < 0);
      ctx.stroke();
      const bisector = startAngle + sweep / 2;
      anchor = { x: points[0].x + (radius + 15) * Math.cos(bisector), y: points[0].y + (radius + 15) * Math.sin(bisector) };
    } else if (measure.mode === "area" && preview.closed) {
      const sum = points.reduce((total, { x, y }) => ({ x: total.x + x, y: total.y + y }), { x: 0, y: 0 });
      anchor = { x: sum.x / points.length, y: sum.y / points.length };
    } else {
      anchor = quickMeasureEdgeAnchor(points.at(-2), points.at(-1), size);
    }
  }
  for (const point of measure.points.slice(0, 12).map(worldToScreen)) {
    ctx.beginPath();
    ctx.arc(point.x, point.y, 3, 0, 2 * Math.PI);
    ctx.fill();
  }
  ctx.restore();
  positionQuickMeasureValue(anchor, size, viewport);
}

function finishQuickMeasureContour() {
  const measure = state.quickMeasure;
  if (!measure || !quickMeasureContour(measure.mode) || measure.method !== "points" || measure.measurement || measure.points.length < 3) return;
  const checked = measureSurveyContour({ type: "polyline", closed: true, points: measure.points });
  if (checked.error) measure.error = "Нужен контур без самопересечений";
  else {
    const value = measure.mode === "area" ? checked.areaM2 : checked.perimeterM * 1000;
    measure.measurement = { points: measure.points, closed: true, value };
  }
  canvas.focus({ preventScroll: true });
  draw();
}

function commitQuickMeasurePoint() {
  const measure = state.quickMeasure;
  if (measure.measurement) {
    measure.points = [];
    measure.measurement = null;
    resetSnapTracking();
  }
  measure.error = "";
  if (measure.method === "existing") {
    const result = quickMeasureFromPlan(measure.mode);
    if (result) measure.measurement = result;
    else measure.error = measure.mode === "radius" ? "Под крестиком нет круга или дуги" : "Под крестиком нет замкнутой области";
  } else if (quickMeasureClosesContour(measure.mode, measure.points, cursorWorld())) {
    finishQuickMeasureContour();
    return;
  } else {
    const point = cursorWorld();
    if (!isLinePoint(point) || measure.points.some((item) => distanceWorld(item, point) <= linePointEpsilon)) {
      measure.error = "Укажите другую точку";
    } else if (measure.points.length >= MAX_PLAN_ANNOTATION_POINTS) {
      measure.error = "Достигнут предел точек. Замкните контур";
    } else {
      measure.points.push(point);
      const count = measure.mode === "distance" ? 2 : quickMeasureContour(measure.mode) ? Infinity : 3;
      if (measure.points.length === count) {
        const result = quickMeasureFromPoints(measure.mode, measure.points);
        if (Number.isFinite(result.value)) measure.measurement = result;
        else {
          measure.points.pop();
          measure.error = "Для радиуса нужны три точки на дуге";
        }
      }
    }
  }
  draw();
}

function lineAxisAngle(axis, start, end) {
  if (axis === "x") return end.x < start.x ? 180 : 0;
  if (axis === "y") return end.y > start.y ? 270 : 90;
  return undefined;
}

function cursorPreviewContext() {
  const draft = state.drawing;
  return [persistence.projectId, spenSettings.mode, spenModeEnabled(), spenSettings.hoverCursor,
    state.tool, state.dimensionTool, state.circleMode, state.angleMode,
    draft, draft?.phase, draft?.arcPhase, draft?.start?.x, draft?.start?.y, draft?.metricConstraint,
    state.planZone, state.planZone?.points.length, state.quickMeasure, state.quickMeasure?.points.length,
    state.moveCommand, state.moveCommand?.base?.x, state.moveCommand?.base?.y, state.offsetCommand,
    state.lineEdit, state.lineEdit?.mirrorStart, state.lineEdit?.firstPick, state.lineEdit?.amount,
    state.selectedEndpoint, state.selectedFigureGrip, state.dimensionAttach, surveyPointPicker, state.additionalDimensionDraft,
    state.blockPlacement, state.entities.length, state.undo.length, state.redo.length,
    state.view.scale, state.view.panX, state.view.panY, state.polarStep, state.snapsMuted, [...state.snaps].join(",")];
}

function sameCursorPreviewContext(context) {
  const current = cursorPreviewContext();
  return context?.length === current.length && context.every((value, index) => value === current[index]);
}

function displayedSnapForPress(event, screen) {
  const preview = state.lastCursorPreview;
  if (!preview || !sameCursorPreviewContext(preview.context)) return null;
  const pen = event.pointerType === "pen" && spenModeEnabled();
  if (pen !== preview.pen) return null;
  if (pen && ((!spenCursorActive() && performance.now() - spenRuntime.hoverExitAt > 300) || pointDistance(screen, preview.screen) > 24)) return null;
  return preview;
}

function pointerPlacesCursorPoint(pointer) {
  if (!pointer) return false;
  if (["survey-point", "dimension-attach", "move-command", "offset-command", "endpoint-place"].includes(pointer.mode)) return true;
  if (pointer.mode === "line-edit") return lineEditPlacesPoint();
  return pointer.mode === "pan" && !state.leaderInput && (state.tool !== "select" || state.quickMeasure || state.blockPlacement);
}

function cursorSnapResolved() {
  const confirmed = state.pointer?.confirmedSnap;
  if (confirmed && sameCursorPreviewContext(confirmed.context)) {
    state.snapTracking.active = confirmed.tracking;
    state.polarSnapGuide = confirmed.polar;
    return confirmed.resolved;
  }
  const raw = rawCursorWorld();
  if (surveyPointPicker) return resolveDimensionPointSnap(raw, { start: null });
  if (state.quickMeasure) return quickMeasureSnap(raw);
  if (state.dimensionAttach) {
    const snap = dimensionAttachCandidate(raw);
    return { point: snap ? { x: snap.x, y: snap.y } : raw, snap };
  }
  if (state.tool === "dimension") return dimensionCursorSnap(raw);
  if (state.tool === "circle" && state.circleMode === "tangent") return { point: raw, snap: null };
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
    const rectangle = rectangleGripReference(raw);
    const resolved = rectangle ? resolveLineLikeSnap(raw, rectangle.start, { useOrtho: false }) : resolveSnapWorld(raw);
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
      ? resolveLineLikeSnap(raw, start, { useGrid: false }) : { point: raw, snap: null };
    state.snapTracking.active = null;
    state.polarSnapGuide = null;
    const point = axisAngle === undefined ? linePointWithConstraint(start, direction.point, constraint) : linePolarPoint(start, constraint.length, axisAngle);
    return { point, snap: direction.snap?.type === "extension" ? direction.snap : null };
  }
  if (start) return resolveLineLikeSnap(raw, start, { useOrtho: state.tool !== "rectangle" });
  return resolveSnapWorld(raw);
}

function colors() {
  const dark = state.theme === "dark";
  return {
    bg: css("--canvas"),
    grid: dark ? "#202a37" : "#e5ebf2",
    majorGrid: dark ? "#2a3645" : "#d2dbe8",
    wall: css("--line"),
    line: css("--line"),
    dimension: "#1f75ff",
    dimensionText: css("--readable-accent"),
    accent: css("--accent"),
    accent2: css("--accent-2"),
    revisionCloud: dark ? "#ff9da2" : "#b62e3b",
    trace: dark ? "#f7c674" : "#996100",
    text: css("--text"),
    muted: css("--muted"),
    axisX: dark ? "#df8e8e" : "#a44143",
    axisY: dark ? "#8dc4a1" : "#2e7950",
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

function annotationScalePreset(value) {
  const factor = annotationScaleFactor(value);
  return ANNOTATION_SCALE_PRESETS.find((preset) => Math.abs(preset.factor - factor) < 0.001) ??
    ANNOTATION_SCALE_PRESETS.reduce((closest, preset) =>
      Math.abs(preset.factor - factor) < Math.abs(closest.factor - factor) ? preset : closest);
}

function syncAnnotationScaleChoice(value) {
  const preset = annotationScalePreset(value);
  annotationScaleSelect.value = String(preset.factor);
  annotationScaleValue.textContent = `1:${preset.denominator}`;
  annotationScaleButton.setAttribute("aria-label", `Масштаб 1:${preset.denominator}. Изменить`);
  for (const button of annotationScaleGrid.querySelectorAll("[data-annotation-scale]")) {
    button.setAttribute("aria-checked", String(Number(button.dataset.annotationScale) === preset.factor));
  }
}

function setAnnotationScale(value, options = {}) {
  const next = annotationScalePreset(value).factor;
  state.annotationScale = next;
  syncAnnotationScaleChoice(next);
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
  refreshOffsetPreviewFromCursor();
  updateLinkedDimensions();
  updateSnapTrackingHover();
  shell.dataset.debugTool = state.tool;
  shell.dataset.debugDrawing = state.drawing ? "1" : "0";
  shell.dataset.debugEntityCount = String(state.entities.length);
  draftMetricLabels.toggleAttribute("data-drawing", Boolean(state.drawing));
  ctx.clearRect(0, 0, rect.width, rect.height);
  ctx.fillStyle = c.bg;
  ctx.fillRect(0, 0, rect.width, rect.height);
  drawGrid(rect, c);
  drawProjectAxes(rect, c);
  drawCanvasCenterCursor(rect);
  syncViewportCoordinates(rect);

  const visible = visibleEntities(rect);
  const editedLeader = state.leaderInput?.entity;
  const editedIndex = editedLeader ? visible.indexOf(editedLeader) : -1;
  if (editedIndex !== -1) {
    const options = state.leaderInput.options;
    visible[editedIndex] = editedLeader.type === "text" ? {
      ...editedLeader,
      height: options.textHeight,
      textFrame: options.leaderFrame,
      text: leaderUi.text.value.trim() || editedLeader.text,
    } : { ...editedLeader, ...options, text: leaderUi.text.value.trim() || editedLeader.text };
  }
  drawPlanScene(visible, c);
  if (state.blockPlacement) drawBlock({ ...state.blockPlacement.preview, ...cursorWorld() }, c, true);
  drawSurveyMarks(c, rect);
  drawPlanAnnotationDraft(c);
  drawQuickMeasure(c, rect);


  const selectedItems = selectedEntities();
  if (!state.drawing && !state.moveCommand && !state.offsetCommand && !state.leaderInput) {
    for (const entity of selectedItems) {
      if (!shouldGhostEntityForCommand(entity)) drawSelection(entity, c);
    }
  }

  const gripReference = rectangleGripReference();
  if (!state.drawing && !gripReference && !state.selectedEndpoint) draftMetricLabels.hidden = true;
  if (state.drawing) {
    if (state.tool === "revision-cloud") {
      drawRevisionCloudDraft(c);
    } else {
      if (state.tool === "polyline") drawPolyline(state.drawing, c, true);
      if (state.tool === "polyline" && state.drawing.arcPhase) drawPolylineArcDraft(state.drawing, c, rect);
      else drawActiveSegment(c, rect);
    }
  } else if (state.moveCommand) {
    drawMoveCommand(c);
  } else if (state.offsetCommand) {
    drawOffsetCommand(c);
  } else if (state.selectedEndpoint) {
    const geometry = selectedEndpointGeometry();
    if (geometry) {
      const previewMoving = lineMetricPreview(state.selectedEndpoint) ?? endpointCursorPoint(geometry);
      const angleAnchor = drawEditableSegment(geometry.fixed, previewMoving, c, { dashed: true });
      updateSelectedEndpointEditors(previewMoving);
      if (isDraftLine(geometry.entity)) drawSegmentMetricLabels(geometry.fixed, previewMoving, angleAnchor, c, rect);
      else draftMetricLabels.hidden = true;
    } else {
      hideInlineEditors();
    }
  } else if (gripReference) {
    gripReference.end = figureMetricPreview(state.selectedFigureGrip) ?? cursorWorld();
    drawFigureDraftMetrics(gripReference, c, rect);
  } else {
    const circle = selectedCircleForMetrics();
    const rectangle = selectedRectangleForMetrics();
    if (circle) updateCircleMetricFields(Math.abs(circle.radius));
    else if (rectangle) updateTopMetricInputs(Math.abs(rectangle.x2 - rectangle.x1), Math.abs(rectangle.y2 - rectangle.y1), { rectangle: true });
    else hideInlineEditors();
  }
  syncSelectionActions();
  syncPlanAnnotationActions();
  syncRevisionCloudControls();
  syncTraceControls();
  syncLeaderTools();
  syncLeaderInputPosition();
  syncLineControls();
  syncCircleControls();
  angleModes.hidden = state.tool !== "dimension" || state.dimensionTool !== "angular" || !dimensionToolMenu.hidden;
  if (!angleModes.hidden && state.angleMode === "select") drawAngleFromSegmentsPreview(c);
  radialModes.hidden = state.tool !== "dimension" || state.dimensionTool !== "radial" || !dimensionToolMenu.hidden;
  chainControls.hidden = state.tool !== "dimension" || state.dimensionTool !== "chain" || !dimensionToolMenu.hidden;
  ordinateModes.hidden = state.tool !== "dimension" || state.dimensionTool !== "ordinate" || !dimensionToolMenu.hidden;
  if (state.tool === "dimension" && state.additionalDimensionDraft) {
    const preview = additionalDimensionAtCursor();
    if (preview) drawAdditionalDimension(preview, c, true);
    else if (state.dimensionTool === "rotated") {
      const draft = state.additionalDimensionDraft;
      drawEditableSegment({ x: draft.x1, y: draft.y1 }, cursorWorld(), c, { dashed: true, showHandles: true });
    }
  }
  if (!radialModes.hidden) {
    const preview = radialDimensionAtCursor();
    if (preview) drawRadialDimension(preview, c, true);
  }
  syncDimensionLinks();
  drawLineEditMarks(c);
  drawSelectionDrag(c);
  drawDimensionSnapHint(c);
  drawCursorSnap(c);
  normalizeDynamicText();
  syncCornerMetricsLayout();
}

function syncCornerMetricsLayout() {
  if (cornerMetrics.hidden || !workspace) {
    cornerMetrics.style.removeProperty("--corner-metrics-top");
    return;
  }
  const metrics = cornerMetrics.getBoundingClientRect();
  if (!metrics.width) {
    cornerMetrics.style.removeProperty("--corner-metrics-top");
    return;
  }
  const workspaceRect = workspace.getBoundingClientRect();
  const panels = [...workspace.querySelectorAll(":scope > :is(.draw-tool-menu, .line-command-panel, .quick-measure-panel, .dimension-assist, .annotation-context, .plan-annotation-actions)")]
    .filter((panel) => !panel.hidden && panel !== cornerMetrics && panel.getClientRects().length)
    .map((panel) => panel.getBoundingClientRect())
    .filter((rect) => rect.top < workspaceRect.top + Math.min(workspaceRect.height / 2, 240));
  const defaultTop = shell.classList.contains("drafting-keyboard-compact") ? 24 : 38;
  const top = nonOverlappingPanelTop(metrics, panels, workspaceRect.top, defaultTop);
  cornerMetrics.style.setProperty("--corner-metrics-top", `${top}px`);
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
  const offsetEdit = state.lineEdit?.mode === "offset";
  const active = Boolean(state.moveCommand || state.offsetCommand || offsetEdit || state.selectedEndpoint || state.selectedFigureGrip);
  shell.dataset.command = state.offsetCommand || offsetEdit ? "offset" : active ? "move" : "";
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
  const sidePoint = cursorWorld();
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
    const preview = { ...entity, x: entity.x + dx, y: entity.y + dy };
    if (isReusableBlock(entity)) drawBlock(preview, c, true);
    else drawBlockOutline(preview, c, true);
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
  const anotherMenuOpen = [drawToolMenu, dimensionToolMenu, annotationToolMenu, selectModeMenu, copyToolMenu, copyControls].some((menu) => !menu.hidden);
  const framing = state.selectionDrag || ["window", "lasso"].includes(state.selectTool);
  const show = editableSelectionEntity() && !framing && !anotherMenuOpen && !state.actionPicking && !state.traceOptions && !snapMore.open && syncSelectToolMenu();
  selectToolMenu.hidden = !show;
  syncToolButtons();
}

function editableSelectionEntity() {
  const selected = selectedEntities();
  const primary = selected.length === 1 || selected.every(blockSourceEntity) ||
    selected.every(canRotateSelectionEntity) || selected.every(canMirrorSelectionEntity) ? selected[0] : null;
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
  return entity?.type === "text" || entity?.dimensionKind === "leader" || Boolean(entity && (isRadialDimension(entity) || additionalDimensionKinds.includes(entity.dimensionKind)));
}

function canMirrorSelectionEntity(entity) {
  return editableFigure(entity, "mirror") || ["wall", "block"].includes(entity?.type);
}

function canRotateSelectionEntity(entity) {
  return Boolean(entity && (isPlanAnnotationZone(entity) || entity.dimensionKind === "leader" ||
    entity.type === "block" || entity.type === "polyline" || linearEditableEntity(entity)));
}

function selectionWorldBounds(entities) {
  const points = entities.flatMap(selectionEntityPoints).filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y));
  if (!points.length) return null;
  return points.reduce((bounds, point) => ({
    minX: Math.min(bounds.minX, point.x), maxX: Math.max(bounds.maxX, point.x),
    minY: Math.min(bounds.minY, point.y), maxY: Math.max(bounds.maxY, point.y),
  }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
}

function canApplySelectionAction(action) {
  const selected = selectedEntities().filter((entity) => isLayerVisible(entity.layer));
  if (!selected.length || state.tool !== "select" || state.selectedFigureGrip || state.drawing || state.leaderInput || state.moveCommand || state.offsetCommand || state.lineEdit) return false;
  if (state.copyPicking) return false;
  if (selected.some(entity => isReusableBlock(entity) && entity.parts.some(part => isLayerLocked(part.layer)))) return false;
  if (action === "properties") return selected.length === 1 && selectedEntities().length === 1;
  if (action === "group") return selected.length >= 2;
  if (action === "scale-selection") return true;
  if (action === "delete" || action === "move") return true;
  if (action === "mirror") return selected.every(canMirrorSelectionEntity);
  if (action === "rotate") return selected.every(canRotateSelectionEntity);
  if (action === "make-block") return !state.traceEditing && state.reusableBlocks.length < MAX_REUSABLE_BLOCKS && selected.every(blockSourceEntity);
  if (action === "explode") return selected.every(canExplodeEntity);
  if (action === "scale" && selected.length === 1 && isReusableBlock(selected[0])) return true;
  if (action === "fillet") return selected.every(isDraftLine);
  if (figureCutActions.has(action)) return selected.length === 1 && editableFigure(selected[0], action);
  if (lineEditActions.has(action)) return selected.length === 1 && isDraftLine(selected[0]);
  if (selected.length !== 1) return false;
  const entity = selected[0];
  if (action === "copy") return true;
  if (action === "mirror") return canMirrorSelectionEntity(entity);
  if (isPlanAnnotationZone(entity) || entity.dimensionKind === "leader") return action === "rotate";
  if (entity.type === "polyline") return action === "rotate";
  if (action === "rotate") return canRotateSelectionEntity(entity);
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
    .filter((entity) => entity && !isLayerLocked(entity.layer) && traceMatchesEditingContext(entity));
}

function canShowEntitySelection() {
  return !printRendering && state.tool === "select";
}

function selectionWithGroups(ids) {
  const expanded = new Set(Array.isArray(ids) ? ids.filter(Boolean) : ids ? [ids] : []);
  const groupIds = new Set(state.entities
    .filter((entity) => expanded.has(entity.id) && typeof entity.groupId === "string" && entity.groupId)
    .map((entity) => entity.groupId));
  if (groupIds.size) {
    for (const entity of state.entities) {
      if (groupIds.has(entity.groupId) && entityMatchesSelectionFilter(entity)) expanded.add(entity.id);
    }
  }
  return [...expanded];
}

function selectedCommonGroupId(selected = selectedEntities()) {
  const groupId = selected[0]?.groupId;
  return selected.length >= 2 && typeof groupId === "string" && groupId && selected.every((entity) => entity.groupId === groupId)
    ? groupId
    : null;
}

function setSelection(ids, options = {}) {
  state.selectionPickCycle = null;
  const requested = selectionWithGroups(ids);
  const nextIds = requested.filter((id) => state.entities.some((entity) => entity.id === id &&
    !isLayerLocked(entity.layer) && traceMatchesEditingContext(entity)));
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

function applyEntityBatch(action, snapshot) {
  const edits = new Map(action.edits.map((edit) => [edit.entityId, edit[snapshot]]));
  state.entities = state.entities.map((entity) => {
    const replacement = edits.get(entity.id);
    return replacement ? cloneProjectEntity(replacement) || entity : entity;
  });
  setSelection(action.selection);
  updateLinkedDimensions();
  markProjectDirty(action.reason || "entity-batch");
  draw();
}

function commitEntityBatch(edits, selection, reason) {
  if (!edits.length) return false;
  const action = { type: "entity-batch", edits, selection, reason };
  applyEntityBatch(action, "after");
  state.undo.push(action);
  state.redo.length = 0;
  return true;
}

function toggleSelectionGroup() {
  const selected = selectedEntities().filter((entity) => isLayerVisible(entity.layer));
  if (selected.length < 2) return;
  const ungroup = Boolean(selectedCommonGroupId(selected));
  const groupId = ungroup ? null : newLineId("group");
  const edits = selected.flatMap((entity) => {
    const before = cloneProjectEntity(entity);
    if (!before) return [];
    const after = { ...before };
    if (groupId) after.groupId = groupId;
    else delete after.groupId;
    return [{ entityId: entity.id, before, after }];
  });
  if (!commitEntityBatch(edits, selected.map((entity) => entity.id), ungroup ? "ungroup" : "group")) return;
  statusChip.textContent = ungroup ? `Разгруппировано объектов: ${selected.length}` : `Сгруппировано объектов: ${selected.length}`;
}

async function scaleSelection() {
  const selected = selectedEntities().filter((entity) => isLayerVisible(entity.layer));
  if (!selected.length || !canApplySelectionAction("scale-selection")) return;
  const value = await showProjectDialog({
    title: "Масштабировать",
    message: `Выбрано объектов: ${selected.length}. Масштабирование выполняется от центра выделения.`,
    value: "1",
    inputLabel: "Коэффициент масштаба",
    confirmText: "Применить",
    maxLength: 12,
    validateValue: (text) => {
      const factor = Number(text.replace(",", "."));
      return Number.isFinite(factor) && factor >= 0.001 && factor <= 1000
        ? ""
        : "Введите коэффициент от 0,001 до 1000";
    },
  });
  if (value == null) return;
  const factor = Number(value.replace(",", "."));
  if (Math.abs(factor - 1) <= 1e-12) {
    statusChip.textContent = "Масштаб не изменён";
    return;
  }
  const bounds = selectionWorldBounds(selected);
  if (!bounds) {
    statusChip.textContent = "Не удалось определить центр выделения";
    return;
  }
  const base = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
  const edits = [];
  for (const entity of selected) {
    const before = cloneProjectEntity(entity);
    const after = scaleStoredEntity(entity, base, factor);
    if (!before || !after || !validStoredEntity(after)) {
      statusChip.textContent = "Масштабирование вышло за допустимый диапазон";
      return;
    }
    edits.push({ entityId: entity.id, before, after });
  }
  if (!commitEntityBatch(edits, selected.map((entity) => entity.id), "scale-selection")) return;
  statusChip.textContent = `Масштабировано объектов: ${selected.length}`;
}

function entityMatchesSelectionFilter(entity) {
  if (!entity || !isLayerVisible(entity.layer) || isLayerLocked(entity.layer) || !traceMatchesEditingContext(entity)) return false;
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
  if (isReusableBlock(entity)) return (expandReusableBlock(entity) ?? []).filter(part => isLayerVisible(part.layer)).flatMap(selectionEntityPoints);
  if (additionalDimensionKinds.includes(entity.dimensionKind)) {
    const art = additionalDimensionArtwork(entity, state.annotationScale);
    return art ? [...additionalDimensionPaths(art).flat(), art.label] : [];
  }
  if (isPlanAnnotationZone(entity)) return entity.contours?.flat() ?? entity.points;
  if (!entity) return [];
  if (isRadialDimension(entity)) {
    const art = radialDimensionArtwork(entity, state.annotationScale);
    return art ? [art.start, art.end, art.label] : [];
  }
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
  if (isReusableBlock(entity)) return (expandReusableBlock(entity) ?? []).filter(part => isLayerVisible(part.layer)).flatMap(selectionEntitySegments);
  if (additionalDimensionKinds.includes(entity?.dimensionKind)) {
    const art = additionalDimensionArtwork(entity, state.annotationScale);
    return art ? additionalDimensionPaths(art).flatMap(path => path.slice(1).map((point, index) => [path[index], point])) : [];
  }
  if (isPlanAnnotationZone(entity)) {
    return (entity.contours ?? [entity.points]).flatMap((ring) => ring.map((point, index) => [point, ring[(index + 1) % ring.length]]));
  }
  if (entity && isRadialDimension(entity)) {
    const art = radialDimensionArtwork(entity, state.annotationScale);
    return art ? [[art.start, art.end], ...(art.landing ? [[art.rim, art.label]] : [])] : [];
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

function startPenSelectionDrag(screen) {
  const pointer = state.pointer;
  if (!pointer?.penWindowCandidate || pointDistance(pointer.startScreen, screen) <= TAP_MOVE_TOLERANCE) return false;
  startSelectionDrag("window", pointer.id, pointer.startScreen);
  state.pointer.moved = true;
  state.pointer.screen = screen;
  updateSelectionDrag(screen);
  return true;
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
  if (state.copyPicking) {
    statusChip.textContent = count ? `Выбрано для копирования: ${count} · нажмите ✓` : "Выберите объекты для копирования";
  } else if (state.actionPicking) {
    statusChip.textContent = selectionActionStatus(state.actionPicking, count);
  } else {
    statusChip.textContent = count ? `Выбрано: ${count}` : selectionStatusText();
  }
  state.openEditMenuAfterPointer = count > 0 && !state.copyPicking && !state.actionPicking;
  if (state.openEditMenuAfterPointer) syncSelectToolMenu();
  else hideSelectToolMenu();
  draw();
}

function selectionActionStatus(action, count = selectedEntities().length) {
  const label = selectionActionLabels[action] || "Операция";
  if (!count) return `${label} · выберите объекты`;
  return canApplySelectionAction(action)
    ? `${label} · выбрано: ${count} · нажмите ✓`
    : `${label} · часть объектов не поддерживается`;
}

function applyTapSelection(hitId) {
  state.traceOptions = false;
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
  if (state.actionPicking) {
    statusChip.textContent = selectionActionStatus(state.actionPicking, count);
    hideSelectToolMenu();
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
    navigating || spenCursorActive() || state.tool !== "select" || lineEditPlacesPoint() ||
    Boolean(state.moveCommand || state.offsetCommand || state.selectedEndpoint || state.selectedFigureGrip || state.dimensionAttach || surveyPointPicker);
  if (!visible) return;
  const pen = spenCursorActive();
  const center = pen ? spenRuntime.point : { x: rect.width / 2, y: rect.height / 2 };
  const arm = pen ? 14 : 36;
  const red = state.theme === "dark" ? "#ff9a9a" : "#a3282d";
  ctx.save();
  ctx.strokeStyle = pen ? colors().accent : red;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(center.x - arm, center.y);
  ctx.lineTo(center.x + arm, center.y);
  ctx.moveTo(center.x, center.y - arm);
  ctx.lineTo(center.x, center.y + arm);
  if (pen) {
    ctx.moveTo(center.x + 4, center.y);
    ctx.arc(center.x, center.y, 4, 0, Math.PI * 2);
  }
  ctx.stroke();
  ctx.restore();
}

function drawProjectAxes(rect, c) {
  const { x, y } = worldToScreen(projectOrigin);
  const showX = y >= 0 && y <= rect.height;
  const showY = x >= 0 && x <= rect.width;
  if (!showX && !showY) return;

  ctx.save();
  ctx.globalAlpha = 0.65;
  ctx.lineWidth = 1;
  if (showX) {
    ctx.strokeStyle = c.axisX;
    linePath(0, y, rect.width, y);
  }
  if (showY) {
    ctx.strokeStyle = c.axisY;
    linePath(x, 0, x, rect.height);
  }
  ctx.restore();

  if (!showX || !showY) return;
  const arm = 43;
  ctx.save();
  ctx.lineWidth = 1.25;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.font = "700 11px Inter, Arial, sans-serif";
  for (const [label, dx, dy, color] of [["X", 1, 0, c.axisX], ["Y", 0, -1, c.axisY]]) {
    const tipX = x + dx * arm;
    const tipY = y + dy * arm;
    ctx.strokeStyle = color;
    linePath(x, y, tipX, tipY);
    linePath(tipX, tipY, tipX - dx * 5 + dy * 3, tipY - dy * 5 - dx * 3);
    linePath(tipX, tipY, tipX - dx * 5 - dy * 3, tipY - dy * 5 + dx * 3);
    ctx.strokeStyle = c.bg;
    ctx.lineWidth = 3;
    const labelX = tipX + 4;
    const labelY = tipY + (dx ? 4 : -1);
    ctx.strokeText(label, labelX, labelY);
    ctx.fillStyle = color;
    ctx.fillText(label, labelX, labelY);
    ctx.lineWidth = 1.25;
  }
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
    if (entity.type === "block" && !isReusableBlock(entity)) {
      return entity.x >= min.x - margin && entity.x <= max.x + margin && entity.y >= min.y - margin && entity.y <= max.y + margin;
    }
    const bounds = entity.dimensionKind === "angular" ? angularDimensionBounds(entity)
      : entity.dimensionKind === "leader" || isRadialDimension(entity) || additionalDimensionKinds.includes(entity.dimensionKind) ? viewportEntityBounds(entity)
      : isPlanAnnotationZone(entity) ? planAnnotationGeometry(entity)?.bounds
        : isReusableBlock(entity) ? reusableBlockBounds(entity)
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

function displayLineWidth(weight = DEFAULT_LINE_WEIGHT) {
  return Math.max(0.8, Math.min(6, 1.4 * weight / DEFAULT_LINE_WEIGHT));
}

function drawPlanScene(entities, c, customLineLayers = state.customLineLayers, layerStyles = state.layerStyles) {
  const paletteForLayer = (id) => {
    const color = normalizeLineLayerColor(layerStyles?.[id]?.color);
    return color ? { ...c, line: color, wall: color, dimension: color, layerColor: color } : c;
  };
  const zones = entities.filter(isPlanAnnotationZone);
  if (!printRendering) zoneLabelRects.clear();
  for (const zone of zones) drawPlanAnnotationZone(zone, paletteForLayer(zone.layer), { outline: true });
  if (zones.length) {
    const anchors = planAnnotationAnchors(zones);
    for (const zone of zones.sort((a, b) => Number(b.type === "area") - Number(a.type === "area") ||
        planAnnotationGeometry(a).areaMm2 - planAnnotationGeometry(b).areaMm2)) {
      drawPlanAnnotationZone(zone, paletteForLayer(zone.layer), { label: true, anchor: anchors.get(zone.id) });
    }
  }
  drawWalls(entities, paletteForLayer("walls"));
  const customLayers = new Map(customLineLayers.map((layer) => [layer.id, layer]));
  for (const entity of entities) {
    if (entity.layer !== TRACE_LAYER && entity.type !== "wall" && !isPlanAnnotationZone(entity)) {
      if (canAssignEntityToLineLayer(entity)) {
        const id = entity.layer || DEFAULT_LINE_LAYER;
        const base = Object.hasOwn(layerMeta, id) ? layerMeta[id] : customLayers.get(id);
        const style = resolveLineStyle(entity, { ...base, ...(layerStyles?.[id] || {}) }, c.line);
        drawEntity(entity, { ...c, line: style.color, revisionCloud: style.color,
          lineWidth: displayLineWidth(style.lineWeight), lineDash: lineTypeDash(style.lineType) });
      } else {
        drawEntity(entity, paletteForLayer(entity.layer));
      }
    }
  }
  if (!printRendering) {
    const palette = { ...c, line: c.trace };
    for (const entity of entities) {
      if (entity.layer === TRACE_LAYER) drawEntity(entity, palette);
    }
  }
}

function planZoneColor(entity, c) {
  if (c.layerColor) return c.layerColor;
  if (entity.type === "area") return state.theme === "dark" ? "#95c6ff" : layerMeta.areas.color;
  const style = PLAN_ELEVATION_STYLES[entity.zoneStyle] || PLAN_ELEVATION_STYLES.ceiling;
  if (state.theme !== "dark") return style.color;
  return { ceiling: "#6fe1b2", beam: "#ffc78a", drop: "#d2b7ff" }[entity.zoneStyle] || "#6fe1b2";
}

function drawPlanAnnotationZone(entity, c, options = {}) {
  const geometry = planAnnotationGeometry(entity);
  if (!geometry) return;
  const color = planZoneColor(entity, c);
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
    const anchor = worldToScreen(options.anchor || geometry.anchor);
    const lines = planZoneLabelLines(entity, geometry, state.measurementSettings);
    const size = planZoneLabelHeight(state.annotationScale) * state.view.scale;
    ctx.font = `700 ${size}px Inter, Arial, sans-serif`;
    const width = Math.max(...lines.map((text) => ctx.measureText(text).width)) + size * 1.2;
    const lineHeight = size * ANNOTATION_LINE_SPACING;
    const height = size * 1.7 + lineHeight * (lines.length - 1);
    const rect = { x: anchor.x - width / 2, y: anchor.y - height / 2, width, height };
    if (!printRendering && options.label) zoneLabelRects.set(entity.id, rect);
    ctx.fillStyle = c.surface;
    ctx.strokeStyle = color;
    ctx.lineWidth = size * 0.065;
    roundedRect(rect.x, rect.y, width, height, size / 3);
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    lines.forEach((text, index) => ctx.fillText(text, anchor.x, anchor.y + (index - (lines.length - 1) / 2) * lineHeight));
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
  ctx.strokeStyle = entity.revisionCloud ? (entity.layer === TRACE_LAYER ? c.trace : c.revisionCloud) : active ? c.accent : c.line;
  ctx.lineWidth = active ? Math.max(2.2, (c.lineWidth || 1.4) + 0.8) : c.lineWidth || 1.4;
  if (dashed) ctx.setLineDash([8, 6]);
  else if (!active && c.lineDash?.length) ctx.setLineDash(c.lineDash);
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

function drawPolylineArcDraft(draft, c, viewport) {
  const cursor = figureMetricPreview(draft) ?? cursorWorld();
  const end = draft.arcEnd || cursor;
  const start = worldToScreen(draft.start);
  const destination = worldToScreen(end);
  const preview = draft.arcEnd && draftArcFromBend(draft.start, end, cursor);
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
  drawFigureDraftMetrics(draftFigureReference(cursor), c, viewport, preview?.arc);
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
  ctx.lineWidth = selected ? Math.max(2, (c.lineWidth || 1.4) + 0.8) : c.lineWidth || 1.4;
  if (!selected && c.lineDash?.length) ctx.setLineDash(c.lineDash);
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
  ctx.lineWidth = selected ? Math.max(2, (c.lineWidth || 1.4) + 0.8) : c.lineWidth || 1.4;
  if (!selected && c.lineDash?.length) ctx.setLineDash(c.lineDash);
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
  ctx.lineWidth = selected ? Math.max(2, (c.lineWidth || 1.4) + 0.8) : c.lineWidth || 1.4;
  if (!selected && c.lineDash?.length) ctx.setLineDash(c.lineDash);
  ctx.beginPath();
  corners.forEach((corner, index) => { const pt = worldToScreen(corner); if (index === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y); });
  ctx.closePath();
  ctx.stroke();
  if (selected && !state.lineEdit && !selectedRectangleForMetrics()) {
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
  ctx.lineWidth = selected ? Math.max(2, (c.lineWidth || 1.4) + 0.8) : c.lineWidth || 1.4;
  if (!selected && c.lineDash?.length) ctx.setLineDash(c.lineDash);
  ctx.beginPath();
  ctx.arc(center.x, center.y, arc.radius * state.view.scale, arc.startAngle, arc.endAngle, !arc.counterClockwise);
  ctx.stroke();
  ctx.restore();
}

function drawTextEntity(entity, c) {
  const p = worldToScreen({ x: entity.x, y: entity.y });
  const layout = textBlockLayout({ ...entity, text: decodeMojibakeText(entity.text) });
  const height = layout.height * state.view.scale;
  const blockWidth = layout.width * state.view.scale;
  const selected = canShowEntitySelection() && state.selectedIds.includes(entity.id) && !state.moveCommand && !state.offsetCommand;
  const spacing = height * ANNOTATION_LINE_SPACING;
  const top = -height;
  const bottom = (layout.lines.length - 1) * spacing + height * 0.22;
  const padding = layout.frame ? height * 0.25 : 0;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(((entity.rotation || 0) * Math.PI) / 180);
  ctx.font = `${height}px Inter, Arial, sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = selected ? c.accent : annotationTextColor(entity, c);
  layout.lines.forEach((line, index) => ctx.fillText(line, 0, index * spacing));
  if (layout.frame) {
    ctx.strokeStyle = selected ? c.accent : annotationTextColor(entity, c);
    ctx.lineWidth = selected ? 1.8 : 1.3;
    ctx.strokeRect(-padding, top - padding, blockWidth + padding * 2, bottom - top + padding * 2);
  }
  if (selected) {
    ctx.strokeStyle = c.accent;
    ctx.lineWidth = 1.4;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(-4 - padding, top - 4 - padding, blockWidth + 8 + padding * 2, bottom - top + 8 + padding * 2);
    ctx.setLineDash([]);
    const handleY = (top + bottom) / 2;
    ctx.beginPath();
    ctx.moveTo(blockWidth, top);
    ctx.lineTo(blockWidth, bottom);
    ctx.stroke();
    ctx.fillStyle = c.surface;
    ctx.beginPath();
    ctx.arc(blockWidth, handleY, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function annotationTextColor(entity, c) {
  if (c.layerColor) return c.layerColor;
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

function pickDimensionCurve(screen, allowCircle, allowInterior = false) {
  for (const target of [screen, inputCursorScreen()]) {
    const world = screenToWorld(target);
    let nearest = screenUiPx(20) / state.view.scale;
    let result = null;
    let interior = null;
    const consider = (entity, arc, point) => {
      if (!point) return;
      const distance = distanceWorld(world, point);
      if (distance >= nearest) return;
      nearest = distance;
      result = { entity, arc, point };
    };
    for (const entity of state.entities) {
      if (!isLayerVisible(entity.layer)) continue;
      if (entity.type === "arc" || (allowCircle && entity.type === "circle")) {
        const point = projectFigurePoint(entity, world);
        consider(entity, entity.type === "arc" ? entity : null, point);
        if (point && allowInterior && entity.type === "circle" &&
            Math.hypot(world.x - entity.cx, world.y - entity.cy) < Math.abs(entity.radius) &&
            (!interior || Math.abs(entity.radius) < Math.abs(interior.entity.radius))) {
          interior = { entity, arc: null, point };
        }
      } else if (entity.type === "polyline") {
        for (const { arc } of polylineSegments(entity)) {
          if (arc) consider(entity, arc, projectFigurePoint(arc, world));
        }
      }
    }
    if (result || interior) return result || interior;
  }
  return null;
}

function additionalDimensionAtCursor() {
  const draft = state.additionalDimensionDraft;
  const mode = state.dimensionTool;
  if (!draft || (mode === "rotated" && draft.measureAngle == null)) return null;
  const label = cursorWorld();
  const entity = { id: "preview", type: "line", layer: "dimensions", dimensionKind: mode, ...draft,
    x2: label.x, y2: label.y };
  if (mode === "ordinate") entity.ordinateAxis = state.ordinateAxis;
  if (mode === "jogged-radius" && !draft.jogCenter) entity.jogCenter = label;
  return entity;
}

function commitAdditionalDimension(world, screen) {
  const mode = state.dimensionTool;
  const draft = state.additionalDimensionDraft;
  if (!draft) {
    if (mode === "ordinate" || mode === "rotated") {
      state.additionalDimensionDraft = { x1: world.x, y1: world.y };
      statusChip.textContent = mode === "ordinate" ? "Укажите положение координаты" : "Укажите вторую точку";
    } else {
      const curve = pickDimensionCurve(screen, mode === "jogged-radius");
      if (!curve) {
        statusChip.textContent = mode === "arc-length" ? "Укажите дугу" : "Укажите дугу или окружность";
        draw();
        return;
      }
      const { entity, arc, point } = curve;
      const geometry = arc ? arcGeometry(arc.start, arc.through, arc.end)
        : { center: { x: entity.cx, y: entity.cy }, radius: Math.abs(entity.radius) };
      if (!geometry) return;
      const { radius } = geometry;
      state.additionalDimensionDraft = mode === "arc-length"
        ? { x1: arc.start.x, y1: arc.start.y, arcStart: arc.start, arcThrough: arc.through, arcEnd: arc.end }
        : { x1: point.x, y1: point.y, circleRadius: radius, jogRim: { x: point.x, y: point.y } };
      statusChip.textContent = mode === "arc-length" ? "Укажите положение размерной дуги" : "Укажите условный центр радиуса";
    }
  } else if (mode === "rotated" && !draft.measureEnd) {
    if (distanceWorld({ x: draft.x1, y: draft.y1 }, world) <= linePointEpsilon) return;
    draft.measureEnd = world;
    statusChip.textContent = "Укажите направление размерной линии от первой точки";
  } else if (mode === "rotated" && draft.measureAngle == null) {
    const from = { x: draft.x1, y: draft.y1 };
    if (distanceWorld(from, world) <= linePointEpsilon) return;
    const angle = angleBetweenPoints(from, world);
    const projected = (draft.measureEnd.x - from.x) * Math.cos(angle) + (draft.measureEnd.y - from.y) * Math.sin(angle);
    if (Math.abs(projected) <= linePointEpsilon) {
      statusChip.textContent = "Выберите направление с ненулевой длиной проекции";
      return;
    }
    draft.measureAngle = angle;
    statusChip.textContent = "Укажите положение размерной линии";
  } else if (mode === "jogged-radius" && !draft.jogCenter) {
    if (distanceWorld(draft.jogRim, world) <= linePointEpsilon) return;
    draft.jogCenter = world;
    statusChip.textContent = "Укажите положение надписи";
  } else {
    const entity = additionalDimensionAtCursor();
    if (!additionalDimensionArtwork(entity, state.annotationScale)) return;
    pushEntity({ ...entity, id: newLineId("dimension") });
    state.additionalDimensionDraft = null;
    resetSnapTracking();
    statusChip.textContent = dimensionToolStatusText();
  }
  draw();
}

function drawAdditionalDimension(entity, c, preview = false) {
  const art = additionalDimensionArtwork(entity, state.annotationScale);
  if (!art) return;
  const color = preview || (canShowEntitySelection() && state.selectedId === entity.id) ? c.accent : c.dimension;
  ctx.save();
  ctx.strokeStyle = ctx.fillStyle = color;
  ctx.lineWidth = 1.5;
  for (const path of art.paths) {
    ctx.beginPath();
    for (const [index, point] of path.entries()) {
      const screen = worldToScreen(point);
      if (index) ctx.lineTo(screen.x, screen.y);
      else ctx.moveTo(screen.x, screen.y);
    }
    ctx.stroke();
  }
  if (art.arc) {
    const { center, radius, startAngle, sweep } = art.arc;
    const screen = worldToScreen(center);
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, radius * state.view.scale, startAngle, startAngle + sweep, sweep < 0);
    ctx.stroke();
  }
  for (const { point, ux, uy } of art.arrows) {
    drawDimensionArrow(worldToScreen(point), ux, uy, art.arrowSize * state.view.scale, { dimension: color });
  }
  drawDimensionCaption(art.label, art.textHeight, art.prefix + projectLength(art.measurement), c.dimensionText ?? color, c.bg);
  ctx.restore();
}

function drawDimensionCaption(point, height, text, color, background) {
  const label = worldToScreen(point);
  const textSize = dimensionLabelSize(height);
  ctx.font = `700 ${textSize}px Inter, Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = background;
  const width = ctx.measureText(text).width + 6;
  ctx.fillRect(label.x - width / 2, label.y - textSize * 0.64, width, textSize * 1.28);
  ctx.fillStyle = color;
  ctx.fillText(text, label.x, label.y);
}

function isRadialDimension(entity) {
  return entity.dimensionKind === "radius" || entity.dimensionKind === "diameter";
}

function radialSourceGeometry() {
  const source = state.radialSource;
  if (!source || !state.entities.includes(source.entity) || !isLayerVisible(source.entity.layer)) return null;
  const { entity, arc } = source;
  return arc ? arcGeometry(arc.start, arc.through, arc.end)
    : { center: { x: entity.cx, y: entity.cy }, radius: Math.abs(entity.radius) };
}

function radialDimensionAtCursor() {
  const geometry = radialSourceGeometry();
  if (!geometry) return null;
  const { arc, point } = state.radialSource;
  const { center, radius } = geometry;
  const label = cursorWorld();
  const rim = arc && (distanceWorld(center, label) <= linePointEpsilon ? point : projectFigurePoint(arc, label));
  return { id: "preview", type: "line", layer: "dimensions", dimensionKind: state.radialMode,
    x1: center.x, y1: center.y, x2: label.x, y2: label.y, circleRadius: radius,
    ...(rim ? { radialRim: { x: rim.x, y: rim.y } } : {}) };
}

function commitRadialDimension(screen) {
  if (state.radialSource) {
    const entity = radialDimensionAtCursor();
    if (entity && [{ x: entity.x1, y: entity.y1 }, { x: entity.x2, y: entity.y2 }].every(isLinePoint) &&
        entity.circleRadius > linePointEpsilon && entity.circleRadius <= MAX_LINE_COORDINATE) {
      pushEntity({ ...entity, id: newLineId("dimension") });
      state.radialSource = null;
      statusChip.textContent = "Размер поставлен · выберите круг или дугу";
      draw();
      return;
    }
    if (entity) {
      statusChip.textContent = "Размер вне области чертежа";
      return;
    }
  }
  state.radialSource = pickDimensionCurve(screen, true, true);
  statusChip.textContent = state.radialSource
    ? "Наведите крестик на место размера и тапните"
    : "Выберите круг или дугу";
  draw();
}

function drawRadialDimension(entity, c, preview = false) {
  const art = radialDimensionArtwork(entity, state.annotationScale);
  if (!art) return;
  const selected = canShowEntitySelection() && state.selectedId === entity.id;
  const color = preview || selected ? c.accent : c.dimension;
  const start = worldToScreen(art.start);
  const end = worldToScreen(art.end);
  const arrowSize = art.arrowSize * state.view.scale;
  const text = `${art.diameter ? "⌀" : "R"} ${projectLength(art.measurement)}`;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  linePath(start.x, start.y, end.x, end.y);
  if (art.landing) {
    const from = worldToScreen(art.rim);
    const to = worldToScreen(art.label);
    linePath(from.x, from.y, to.x, to.y);
  }
  const sign = art.inside ? -1 : 1;
  drawDimensionArrow(worldToScreen(art.rim), art.ux * sign, art.uy * sign, arrowSize, { dimension: color });
  if (art.diameter) drawDimensionArrow(worldToScreen(art.opposite), art.ux, art.uy, arrowSize, { dimension: color });
  drawDimensionCaption(art.label, art.textHeight, text, c.dimensionText ?? color, c.bg);
  ctx.restore();
}

function drawDimensionEntity(entity, c, options = {}) {
  if (additionalDimensionKinds.includes(entity.dimensionKind)) {
    drawAdditionalDimension(entity, c, options.active);
    return;
  }
  if (isRadialDimension(entity)) {
    drawRadialDimension(entity, c);
    return;
  }
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

function dimensionLabelSize(height) {
  return height * state.view.scale;
}

function drawDimensionLabel(text, label, height, rotation, c) {
  const point = worldToScreen(label);
  const size = dimensionLabelSize(height);
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
  ctx.fillStyle = c.dimensionText ?? c.dimension;
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

function drawBlock(entity, c, preview = false) {
  if (isReusableBlock(entity)) {
    ctx.save();
    if (preview || shouldGhostEntityForCommand(entity)) ctx.globalAlpha = preview ? 0.65 : 0.28;
    for (const part of expandReusableBlock(entity) ?? []) {
      if (!printRendering && !isLayerVisible(part.layer)) continue;
      const color = state.customLineLayers.find(layer => layer.id === part.layer)?.color;
      drawEntity(part, color ? { ...c, line: color } : c);
    }
    ctx.restore();
    return;
  }
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
    label: worldToScreen(art.label), labelHeight: dimensionLabelSize(art.textHeight),
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
    entity.dimensionKind !== "angular" && entity.dimensionKind !== "leader" && !isRadialDimension(entity) && !additionalDimensionKinds.includes(entity.dimensionKind);
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
  if (isLayerLocked(entity.layer)) return;
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
  if (state.tool === "circle" && state.circleMode !== "center") {
    drawActiveCircleConstruction(c);
    return;
  }
  const { start } = state.drawing;
  const metricPreview = figureMetricPreview(state.drawing) ?? lineMetricPreview(start);
  const end = metricPreview ?? (state.drawing.lockedEnd ? state.drawing.end : cursorWorld());
  if (!metricPreview) state.drawing.end = end;
  if (state.tool === "circle" || state.tool === "rectangle" || state.tool === "arc") {
    const ref = draftFigureReference(end);
    const arc = ref.arcEnd && draftArcFromBend(start, ref.arcEnd, end)?.arc;
    if (state.tool === "circle") drawActiveCircle(start, end, c);
    else if (state.tool === "rectangle") drawActiveRectangle(start, end, c);
    else drawActiveArc(c, end, arc);
    drawFigureDraftMetrics(ref, c, viewport, arc);
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
        const { elbow } = leaderScreenGeometry(preview);
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
    if (state.dimensionTool === "chain" || state.drawing.phase === "offset") {
      provisional.offset = draftDimensionOffset(initialGeometry, state.drawing.phase === "offset" ? cursorWorld() : end);
    }
    drawDimensionEntity(provisional, c);
    drawHandle(p1.x, p1.y, c);
    drawHandle(p2.x, p2.y, c);
    hideInlineEditors();
    return;
  }

  const angleAnchor = drawEditableSegment(start, end, c, { lineWidth: 2.2, showHandles: state.tool !== "line" });
  updateInlineEditors(start, end, metrics, angleInfo);
  if (["line", "polyline"].includes(state.tool) && !surveyPointPicker) {
    drawSegmentMetricLabels(start, end, angleAnchor, c, viewport);
  }
}

function drawSegmentMetricLabels(start, end, angleAnchor, c, viewport) {
  const from = worldToScreen(start);
  const to = worldToScreen(end);
  const middle = midpoint(from, to);
  const lengthAnchor = drawDraftLengthDimension(from, to, c, viewport) ?? { x: middle.x, y: middle.y - 32 };
  const angleLabel = angleAnchor ?? { x: to.x, y: to.y + 32 };
  updateDraftMetricLabels(lengthAnchor, angleLabel, distanceWorld(start, end), activeAngleInfo(start, end), viewport,
    { canvasColors: state.drawing ? undefined : c });
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

function rectangleGripReference(end) {
  const grip = state.selectedFigureGrip;
  if (grip?.key !== "corner") return null;
  const entity = state.entities.find(item => item.id === grip.entityId && item.type === "rectangle");
  if (!entity) return null;
  return { key: grip, start: rectangleCorners(entity)[(grip.index + 2) % 4], end, type: "rectangle" };
}

function draftFigureReference(end) {
  const draft = state.drawing;
  if (!draft) return null;
  if (state.tool === "circle" && state.circleMode !== "center") return null;
  if (state.tool === "rectangle" || state.tool === "circle") {
    return { key: draft, start: draft.start, end, type: state.tool };
  }
  if (state.tool === "arc" || draft.arcPhase) {
    return { key: draft, start: draft.start, end, type: draft.arcEnd ? "bend" : "chord", arcEnd: draft.arcEnd };
  }
  return null;
}

function figureMetrics(ref, arc) {
  const { start, end, type } = ref;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (type === "rectangle") return { names: ["Длина", "Ширина"], symbols: ["↔", "↕"], values: [Math.abs(dx), Math.abs(dy)], angle: false };
  if (type === "bend") return { names: ["Радиус", "Угол дуги"], symbols: ["R", "∠"],
    values: [arc?.radius, arc && radToDeg(Math.abs(arc.sweep))], angle: true };
  return { names: [type === "circle" ? "Радиус" : "Хорда", "Угол"],
    symbols: [type === "circle" ? "R" : "↔", "∠"],
    values: [Math.hypot(dx, dy), normalizeDegrees(-radToDeg(Math.atan2(dy, dx)))], angle: true };
}

function drawFigureDraftMetrics(ref, c, viewport, arc) {
  if (!ref || surveyPointPicker) return;
  const { start, end, type } = ref;
  const { names, symbols, values, angle } = figureMetrics(ref, arc);
  const from = worldToScreen(start);
  const to = worldToScreen(end);
  let first;
  let second;
  if (type === "rectangle") {
    const corner = { x: from.x, y: to.y };
    first = drawDraftLengthDimension(corner, to, c, viewport) || { x: to.x - 38, y: to.y - 36 };
    second = drawDraftLengthDimension({ x: to.x, y: from.y }, to, c, viewport) || { x: to.x + 38, y: to.y - 36 };
  } else if (type === "bend") {
    const bend = worldToScreen(arc?.through ?? midpoint(start, ref.arcEnd));
    first = { x: bend.x, y: bend.y - 26 };
  } else {
    first = drawDraftLengthDimension(from, to, c, viewport) || { x: to.x - 40, y: to.y - 36 };
    second = drawAngleArc(from, to, activeAngleInfo(start, end), c) || { x: to.x + 40, y: to.y - 36 };
  }
  if (type === "circle") {
    updateCircleMetricFields(values[0], values[1]);
  } else {
    updateTopMetricInputs(values[0], values[1], { rectangle: !angle, names, symbols, cadAngle: type === "chord" });
  }
  updateDraftMetricLabels(first, second, values[0], { degrees: values[1], angle, cadAngle: type === "circle" || type === "chord" },
    viewport, { names, symbols, paired: type === "circle" || type === "bend" });
}

function figureMetricContext(input) {
  if (!lineMetricKinds.has(input) || input.closest("[hidden]")) return null;
  const ref = rectangleGripReference() || draftFigureReference();
  if (!ref || ((input === lengthInput || input === angleInput) && ref.type !== "circle")) return null;
  const edit = state.numericEdit?.figureMetric;
  if (edit?.key === ref.key) return edit;
  ref.end = ref.key === state.drawing && state.drawing.lockedEnd ? state.drawing.end : cursorWorld();
  return ref;
}

function exactFigurePoint(edit, kind, value) {
  const { start, end, type, arcEnd } = edit;
  if (!Number.isFinite(value) || (kind === "length" && value <= linePointEpsilon)) return null;
  const { values } = figureMetrics(edit);
  if (type === "rectangle") {
    if (value <= linePointEpsilon) return null;
    const length = edit.values.length ?? values[0];
    const width = edit.values.angle ?? values[1];
    return length > linePointEpsilon && width > linePointEpsilon ? {
      x: start.x + (Math.sign(end.x - start.x) || 1) * length,
      y: start.y + (Math.sign(end.y - start.y) || 1) * width,
    } : null;
  }
  if (type === "bend") {
    const mid = midpoint(start, arcEnd);
    const half = distanceWorld(start, arcEnd) / 2;
    const nx = -(arcEnd.y - start.y) / (2 * half);
    const ny = (arcEnd.x - start.x) / (2 * half);
    const sagitta = (end.x - mid.x) * nx + (end.y - mid.y) * ny;
    if (kind === "length" && (value < half - linePointEpsilon || value > MAX_LINE_COORDINATE)) return null;
    if (kind === "angle" && !(value > 0 && value < 360)) return null;
    const root = kind === "length" ? Math.sqrt(Math.max(0, (value - half) * (value + half))) : 0;
    const height = kind === "angle" ? half * Math.tan(value * Math.PI / 720)
      : Math.abs(sagitta) > half ? value + root : half * half / (value + root);
    const signed = height * (Math.sign(sagitta) || 1);
    const point = { x: mid.x + nx * signed, y: mid.y + ny * signed };
    return draftArcFromBend(start, arcEnd, point) ? point : null;
  }
  const length = edit.values.length ?? values[0];
  const angle = edit.values.angle ?? values[1];
  return length > linePointEpsilon ? linePolarPoint(start, length, angle) : null;
}

function updateFigureMetricInput(input) {
  const edit = state.numericEdit.figureMetric;
  const kind = lineMetricKinds.get(input);
  edit.texts[kind] = input.value;
  const asLength = kind === "length" || edit.type === "rectangle";
  const value = asLength ? readProjectLength(input) : parseLineDecimal(input.value);
  if (edit.type === "bend") {
    const other = kind === "length" ? "angle" : "length";
    delete edit.texts[other];
    delete edit.values[other];
  }
  edit.values[kind] = value;
  edit.point = exactFigurePoint(edit, kind, value);
  input.removeAttribute("aria-invalid");
  draw();
}

function figureMetricPreview(key) {
  const edit = state.numericEdit?.figureMetric;
  if (!edit || edit.key !== key) return null;
  return isLinePoint(edit.point) ? edit.point : edit.lockedBySpen ? edit.end : null;
}

function confirmFigureMetricInput(input, edit) {
  if (!Object.keys(edit.texts).length) {
    cancelFigureMetricInput();
    return;
  }
  const point = isLinePoint(edit.point) ? edit.point : null;
  const draft = state.drawing;
  const grip = state.selectedFigureGrip;
  const target = grip && state.entities.find(entity => entity.id === grip.entityId);
  if (!point || (grip && (!target || !reshapeFigure(target, grip, point)))) {
    input.setAttribute("aria-invalid", "true");
    statusChip.textContent = edit.type === "bend" ? "Проверьте радиус или угол дуги" : "Введите допустимый размер и укажите направление";
    return;
  }
  cancelFigureMetricInput();
  if (edit.key === state.selectedFigureGrip) {
    commitFigureGripPoint(point);
  } else if (draft === edit.key) {
    draft.lockedEnd = false;
    commitCursorPoint(inputCursorScreen(), point);
  }
}

function cancelFigureMetricInput() {
  if (state.numericEdit?.figureMetric) state.numericEdit = null;
  for (const input of lineMetricKinds.keys()) input.removeAttribute("aria-invalid");
  closeMetricEntry();
  draw();
}

function draftMetricPosition(point, { halfWidth, halfHeight }, viewport, placed = null,
  controls = { left: viewport.width - 156, right: viewport.width, top: 0, bottom: 78 }) {
  const compact = shell.classList.contains("drafting-keyboard-compact");
  const maxY = Math.max(halfHeight, viewport.height - Math.max(70, draftingKeyboardInset + 6) - halfHeight);
  const minY = Math.min(compact ? 28 : 43, maxY);
  const minX = halfWidth + 4;
  const maxX = Math.max(minX, viewport.width - halfWidth - 4);
  const obstacles = [
    controls,
    { left: viewport.width / 2 - 12, right: viewport.width / 2 + 12,
      top: viewport.height / 2 - 12, bottom: viewport.height / 2 + 12 },
  ];
  if (placed) {
    obstacles.push({ left: placed.x - placed.halfWidth - 4, right: placed.x + placed.halfWidth + 4,
      top: placed.y - placed.halfHeight - 2, bottom: placed.y + placed.halfHeight + 2 });
  }

  const xCandidates = [Math.max(minX, Math.min(maxX, point.x))];
  const yCandidates = [Math.max(minY, Math.min(maxY, point.y))];
  for (const obstacle of obstacles) {
    xCandidates.push(obstacle.left - halfWidth, obstacle.right + halfWidth);
    yCandidates.push(obstacle.top - halfHeight, obstacle.bottom + halfHeight);
  }
  let best = null;
  let nearest = Infinity;
  for (const y of yCandidates) {
    if (y < minY || y > maxY) continue;
    for (const x of xCandidates) {
      if (x < minX || x > maxX || obstacles.some(({ left, right, top, bottom }) =>
        x + halfWidth > left && x - halfWidth < right && y + halfHeight > top && y - halfHeight < bottom)) continue;
      const distance = Math.hypot(x - point.x, y - point.y);
      if (distance >= nearest) continue;
      best = { x, y };
      nearest = distance;
    }
  }
  return best ?? { x: xCandidates[0], y: yCandidates[0] };
}

function updateDraftMetricLabels(lengthAnchor, angleAnchor, length, angleInfo, viewport,
  { names, symbols = ["↔", "∠"], paired = false, canvasColors } = {}) {
  draftMetricLabels.hidden = false;
  draftLengthInput.setAttribute("aria-label", names?.[0] ?? "Длина линии на чертеже");
  draftAngleInput.setAttribute("aria-label", names?.[1] ?? "Угол линии на чертеже");
  draftMetricLabels.querySelectorAll(".metric-field-name").forEach((name, index) => {
    name.textContent = symbols[index];
  });
  draftMetricLabels.toggleAttribute("data-paired", paired);
  draftMetricLabels.toggleAttribute("data-canvas-readouts", Boolean(canvasColors));
  updateMetricField(draftLengthInput, draftLengthReadout, length);
  updateMetricField(draftAngleInput, draftAngleReadout, angleInfo.degrees, { angle: angleInfo.angle !== false, wrap: angleInfo.cadAngle });
  const activeInput = numericConfirmInput();
  let controls;
  if (!cornerMetrics.hidden) {
    const panel = cornerMetrics.getBoundingClientRect();
    if (panel.width) controls = { left: panel.left - viewport.left - 2, right: panel.right - viewport.left + 2,
      top: panel.top - viewport.top - 2, bottom: panel.bottom - viewport.top + 2 };
  }
  if (paired) {
    draftLengthInput.parentElement.hidden = draftAngleInput.parentElement.hidden = false;
    const pinned = draftMetricPair.contains(activeInput) || [...pressedMetricFields].some((field) => draftMetricPair.contains(field));
    const { style } = draftMetricPair;
    const anchor = pinned && style.left ? { x: parseFloat(style.left), y: parseFloat(style.top) } : lengthAnchor;
    const size = { halfWidth: draftMetricPair.offsetWidth / 2, halfHeight: draftMetricPair.offsetHeight / 2 };
    const { x, y } = draftMetricPosition(anchor, size, viewport, null, controls);
    style.left = `${x}px`;
    style.top = `${y}px`;
    return;
  }
  const entries = [[draftLengthInput, lengthAnchor], [draftAngleInput, angleAnchor]];
  if (activeInput === draftAngleInput || pressedMetricFields.has(draftAngleInput.parentElement)) entries.reverse();
  let placed = null;
  for (const [input, anchor] of entries) {
    const field = input.parentElement;
    const pinned = input === activeInput || pressedMetricFields.has(field);
    const lastX = field.style.getPropertyValue("--metric-x");
    const previous = lastX && !field.hidden ? { x: parseFloat(lastX), y: parseFloat(field.style.getPropertyValue("--metric-y")) } : null;
    const point = (pinned && previous) || anchor;
    field.hidden = !point;
    if (!point) continue;

    const size = { halfWidth: (field.offsetWidth || 48) / 2, halfHeight: (field.offsetHeight || 40) / 2 };
    const { x, y } = draftMetricPosition(point, size, viewport, placed, controls);
    field.style.setProperty("--metric-x", `${x}px`);
    field.style.setProperty("--metric-y", `${y}px`);
    placed = { x, y, ...size };
    if (canvasColors && document.activeElement !== input) drawCanvasMetricReadout(field, placed, canvasColors);
  }
}

function drawCanvasMetricReadout(field, { x, y, halfWidth }, c) {
  const symbol = field.querySelector(".metric-field-name").textContent;
  const value = field.querySelector(".metric-readout").textContent;
  const unit = field.querySelector(".metric-unit").textContent;
  const text = `${symbol} ${value}${unit === "°" ? "" : " "}${unit}`;
  const width = 2 * halfWidth;
  ctx.save();
  ctx.fillStyle = c.surface;
  ctx.strokeStyle = c.border;
  ctx.lineWidth = 1;
  roundedRect(x - halfWidth, y - 12, width, 24, 5);
  ctx.font = "800 12px Inter, Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = c.dimensionText;
  ctx.fillText(text, x, y, width - 8);
  ctx.restore();
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
  const current = angleSideAt(inputCursorScreen(), first);
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
}

function circleConstructionHint() {
  const count = state.drawing?.circlePicks?.length || 0;
  if (state.circleMode === "tangent") {
    return ["Круг · первая касательная", "Круг · вторая касательная", "Круг · введите радиус"][count];
  }
  if (state.circleMode === "diameter") return count ? "Круг · второй конец диаметра" : "Круг · первый конец диаметра";
  if (state.circleMode === "three") return ["Круг · первая точка", "Круг · вторая точка", "Круг · третья точка"][count];
  return "Круг · укажите центр";
}

function syncCircleControls() {
  const active = state.tool === "circle" && !surveyPointPicker && drawToolMenu.hidden;
  circleControls.hidden = !active;
  circleTangentForm.hidden = !active || state.circleMode !== "tangent" || state.drawing?.circlePicks?.length !== 2;
  if (circleTangentForm.hidden && !circleTangentError.hidden) showCircleTangentError("");
  if (!active) return;
  for (const button of circleModeButtons) {
    button.setAttribute("aria-pressed", String(button.dataset.circleMode === state.circleMode));
  }
  const unit = projectUnit(state.measurementSettings).label;
  if (circleTangentUnit.textContent !== unit) {
    circleTangentUnit.textContent = unit;
    circleTangentRadius.setAttribute("aria-label", `Радиус касательного круга, ${unit}`);
  }
}

function showCircleTangentError(message) {
  if (circleTangentError.textContent !== message) circleTangentError.textContent = message;
  circleTangentError.hidden = !message;
  if (message) circleTangentRadius.setAttribute("aria-invalid", "true");
  else circleTangentRadius.removeAttribute("aria-invalid");
}

function circleConstructionPreview(point) {
  const picks = state.drawing.circlePicks;
  if (state.circleMode === "diameter") return diameterCircle(picks[0], point);
  if (state.circleMode === "three") return picks.length === 2 ? threePointCircle(picks[0], picks[1], point) : null;
  return picks.length === 2 ? tangentRadiusCircle(picks[0].edge, picks[1].edge, readProjectLength(circleTangentRadius),
    picks[0].point, picks[1].point) : null;
}

function drawActiveCircleConstruction(c) {
  draftMetricLabels.hidden = true;
  const draft = state.drawing;
  const tangent = state.circleMode === "tangent";
  const point = tangent ? null : cursorWorld();
  const circle = circleConstructionPreview(point);
  const points = tangent ? circle?.contacts ?? draft.circlePicks.map((pick) => pick.point) : [...draft.circlePicks, point];
  if (circle) drawCircleEntity({ ...circle, id: "circle-preview" }, { ...c, line: c.accent });
  const screen = points.map(worldToScreen);
  ctx.save();
  if (!tangent && screen.length > 1) {
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = c.accent;
    ctx.lineWidth = 1;
    for (let index = 1; index < screen.length; index++) {
      linePath(screen[index - 1].x, screen[index - 1].y, screen[index].x, screen[index].y);
    }
  }
  for (const handle of screen) drawEndpointHandle(handle, false, c);
  ctx.restore();
}

function pickCircleTangent(screen) {
  const boundaries = boundarySegments();
  const center = inputCursorScreen();
  const targets = pointDistance(screen, center) > 1 ? [screen, center] : [center];
  for (const target of targets) {
    const world = screenToWorld(target);
    let nearest = screenUiPx(20) / state.view.scale;
    let best = null;
    for (const edge of boundaries) {
      const pick = nearestBoundaryPoint(world, [edge], nearest);
      if (!pick) continue;
      nearest = distanceWorld(world, pick);
      best = { edge, point: { x: pick.x, y: pick.y } };
    }
    if (best) return { ...best, key: tangentBoundaryKey(best.edge) };
  }
  return null;
}

function tangentBoundaryKey(edge) {
  if (edge.type === "circle") return `circle:${edge.cx}:${edge.cy}:${edge.radius}`;
  if (edge.type === "arc") return `arc:${[edge.start, edge.through, edge.end].map(({ x, y }) => `${x}:${y}`).sort().join(";")}`;
  return `segment:${[`${edge.x1}:${edge.y1}`, `${edge.x2}:${edge.y2}`].sort().join(";")}`;
}

function finishCircleConstruction(circle) {
  const layer = state.drawing.layer;
  if (!layer || isLayerLocked(layer)) {
    statusChip.textContent = layerLockMessage(layer);
    return;
  }
  pushEntity(circleEntity(newLineId("circle"), circle.cx, circle.cy, circle.radius, layer));
  resetSnapTracking();
  setTool("select");
  canvas.focus({ preventScroll: true });
  statusChip.textContent = `Круг · R ${projectLength(circle.radius)}`;
  draw();
}

function commitCircleConstruction(screen, world) {
  const draft = state.drawing;
  const tangent = state.circleMode === "tangent";
  if (tangent && draft?.circlePicks.length === 2) {
    circleTangentRadius.focus({ preventScroll: true });
    return;
  }
  const layer = draft?.layer ?? revealActiveLineLayer();
  if (!layer || isLayerLocked(layer)) {
    statusChip.textContent = layerLockMessage(layer);
    return;
  }
  const pick = tangent ? pickCircleTangent(screen) : isLinePoint(world) ? world : null;
  if (!pick) {
    statusChip.textContent = tangent ? "Выберите линию, дугу или круг" : "Точка вне области чертежа";
    return;
  }
  const duplicate = draft?.circlePicks.some((previous) => tangent ? previous.key === pick.key : distanceWorld(previous, pick) <= linePointEpsilon);
  if (duplicate) {
    statusChip.textContent = tangent ? "Выберите другую касательную" : "Выберите другую точку";
    return;
  }
  if (!tangent && draft && (state.circleMode === "diameter" || draft.circlePicks.length === 2)) {
    const circle = circleConstructionPreview(pick);
    if (circle) finishCircleConstruction(circle);
    else {
      statusChip.textContent = state.circleMode === "three" ? "Три точки должны образовать круг в пределах чертежа" : "Диаметр вне области чертежа";
      draw();
    }
    return;
  }
  if (!draft) {
    setSelection(null);
    hideInlineEditors();
    hideDrawToolMenu();
    circleTangentRadius.value = "";
  }
  const point = tangent ? pick.point : pick;
  state.drawing = { circlePicks: [...(draft?.circlePicks ?? []), pick], start: point, end: point, layer };
  resetSnapTracking();
  statusChip.textContent = circleConstructionHint();
  syncCircleControls();
  if (!circleTangentForm.hidden) circleTangentRadius.focus({ preventScroll: true });
  draw();
}

function undoCircleConstruction() {
  if (state.tool !== "circle" || !state.drawing?.circlePicks?.length) return false;
  const draft = state.drawing;
  draft.circlePicks.pop();
  const previous = draft.circlePicks.at(-1);
  if (previous) draft.start = draft.end = previous.point ?? previous;
  else state.drawing = null;
  circleTangentRadius.value = "";
  canvas.focus({ preventScroll: true });
  resetSnapTracking();
  statusChip.textContent = circleConstructionHint();
  draw();
  return true;
}

circleConstruction.addEventListener("click", (event) => {
  const mode = event.target.closest("[data-circle-mode]")?.dataset.circleMode;
  if (!mode || mode === state.circleMode) return;
  state.circleMode = mode;
  setTool("circle");
  canvas.focus({ preventScroll: true });
});
circleTangentRadius.addEventListener("input", () => {
  showCircleTangentError("");
  draw();
});
circleTangentRadius.addEventListener("focus", updateViewportLock);
circleTangentRadius.addEventListener("blur", () => window.setTimeout(updateViewportLock, 80));
circleTangentRadius.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  event.preventDefault();
  event.stopPropagation();
  undoCircleConstruction();
});
circleTangentForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (circleTangentForm.hidden || state.drawing?.circlePicks?.length !== 2) return;
  const circle = circleConstructionPreview(null);
  if (circle) finishCircleConstruction(circle);
  else {
    const error = readProjectLength(circleTangentRadius) > 0 ? "Нет круга с этим радиусом на выбранных касательных" : "Введите радиус больше нуля";
    showCircleTangentError(error);
    statusChip.textContent = error;
    circleTangentRadius.focus({ preventScroll: true });
  }
});

function drawActiveRectangle(start, end, c) {
  drawRectangleEntity(rectangleEntity("preview", start.x, start.y, end.x, end.y), { ...c, line: c.accent });
}

function drawActiveArc(c, current, arc) {
  const drawing = state.drawing;
  const pStart = worldToScreen(drawing.start);
  const pCurrent = worldToScreen(current);
  ctx.save();
  ctx.strokeStyle = c.accent;
  ctx.fillStyle = c.accent;
  ctx.lineWidth = 1.8;
  ctx.setLineDash([8, 6]);
  if (!drawing.arcEnd) {
    linePath(pStart.x, pStart.y, pCurrent.x, pCurrent.y);
  } else {
    const pEnd = worldToScreen(drawing.arcEnd);
    if (arc) {
      ctx.setLineDash([]);
      ctx.beginPath();
      appendPolylineArcPath(arc);
      ctx.stroke();
      const pThrough = worldToScreen(arc.through);
      const pChordMid = midpoint(pStart, pEnd);
      ctx.setLineDash([6, 5]);
      ctx.globalAlpha = 0.7;
      linePath(pChordMid.x, pChordMid.y, pThrough.x, pThrough.y);
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      drawHandle(pThrough.x, pThrough.y, c);
    } else {
      linePath(pStart.x, pStart.y, pEnd.x, pEnd.y);
      ctx.setLineDash([]);
    }
    drawHandle(pEnd.x, pEnd.y, c);
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

function formatEditableNumber(value, maxFractionDigits = 4) {
  if (!Number.isFinite(Number(value))) return "";
  return String(Number(Number(value).toFixed(maxFractionDigits)));
}

function readProjectLength(input) {
  return fromProjectLength(parseLineDecimal(input.value), state.measurementSettings);
}

function updateMetricField(input, readout, value, { angle = false, wrap = false } = {}) {
  const settings = state.measurementSettings;
  const formatted = angle ? formatProjectAngle(value, settings, { suffix: false, wrap }) : formatProjectLength(value, settings, { suffix: false });
  const text = steppedMetricInput === input ? input.value.replace(".", ",") || "—" : formatted;
  if (readout.textContent !== text) readout.textContent = text;
  const unit = input.parentElement.querySelector(".metric-unit");
  const unitText = angle ? "°" : projectUnit(settings).label;
  if (unit && unit.textContent !== unitText) unit.textContent = unitText;
  if (numericConfirmInput() === input) return;
  const edit = state.numericEdit;
  const buffer = (edit?.lineMetric ?? edit?.figureMetric)?.texts?.[lineMetricKinds.get(input)];
  input.value = buffer ?? (Number.isFinite(value) ? formatted : "");
  syncInlineEditorWidth(input);
}

function updateInlineEditors(start, end, metrics, angleInfo) {
  inlineEditors.hidden = false;
  const lineDraft = state.tool === "line" || state.tool === "polyline";
  drawMetrics.hidden = true;
  lengthEditor.hidden = false;
  angleEditor.hidden = false;
  lengthMetricName.textContent = "↔";
  lengthInput.setAttribute("aria-label", "Длина линии");
  angleInput.setAttribute("aria-label", "Угол линии");
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

function updateTopMetricInputs(length, angle, { cadAngle = false, rectangle = false, names, symbols } = {}) {
  drawMetrics.hidden = false;
  inlineEditors.hidden = true;
  const rotating = state.moveCommand?.mode === "rotate";
  topLengthName.textContent = symbols?.[0] ?? (state.offsetCommand ? "∥" : "↔");
  topAngleName.textContent = symbols?.[1] ?? (rectangle ? "↕" : "∠");
  topLengthInput.parentElement.hidden = rotating;
  topAngleInput.parentElement.hidden = Boolean(state.offsetCommand);
  topLengthInput.setAttribute("aria-label", rectangle ? "Длина прямоугольника" : names?.[0] ?? (state.offsetCommand ? "Смещение" : "Длина"));
  topAngleInput.setAttribute("aria-label", rectangle ? "Ширина прямоугольника" : names?.[1] ?? "Угол");
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

function selectedRectangleForMetrics() {
  if (!viewportIsSelecting() || state.selectedIds.length !== 1 || state.copyPicking || state.actionPicking || surveyPointPicker) return null;
  const entity = state.entities.find(item => item.id === state.selectedId);
  return entity?.type === "rectangle" && isLayerVisible(entity.layer) ? entity : null;
}

function selectedCircleForMetrics() {
  if (state.tool !== "select" || state.selectedIds.length !== 1 || state.lineEdit || state.actionPicking || surveyPointPicker) return null;
  const entity = state.entities.find((item) => item.id === state.selectedId);
  return entity?.type === "circle" ? entity : null;
}

function updateCircleMetricFields(radius, angle) {
  inlineEditors.hidden = false;
  drawMetrics.hidden = true;
  lengthEditor.hidden = false;
  angleEditor.hidden = !Number.isFinite(angle);
  lineDirectionDescription.textContent = "";
  lengthMetricName.textContent = "R";
  lengthInput.setAttribute("aria-label", "Радиус круга");
  updateMetricField(lengthInput, lengthReadout, radius);
  if (!angleEditor.hidden) {
    angleInput.setAttribute("aria-label", "Угол радиуса");
    updateMetricField(angleInput, angleReadout, angle, { angle: true, wrap: true });
  }
}

function selectedEndpointGeometry() {
  const endpoint = state.selectedEndpoint;
  if (!endpoint) return null;
  const entity = state.entities.find((item) => item.id === endpoint.entityId);
  if (!entity || entity.type === "block") return null;
  return lineEndpointGeometry(entity, endpoint.point);
}

function lineEndpointGeometry(entity, side) {
  const start = { x: entity.x1, y: entity.y1 };
  const end = { x: entity.x2, y: entity.y2 };
  return side === "start"
    ? { entity, side, fixed: end, moving: start }
    : { entity, side, fixed: start, moving: end };
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
  if (state.pointer?.confirmedSnap) return cursorWorld();
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
  input.style.setProperty("--value-width", `${Math.max(1.5, Math.min(12, length + 0.4))}ch`);
}

function selectInlineValue(input) {
  window.setTimeout(() => {
    if (document.activeElement === input) input.select();
  }, 0);
}

function editableEntityForNumericInput() {
  if (state.circleRadiusEdit) return state.entities.find((item) => item.id === state.circleRadiusEdit.entityId) || null;
  if (state.selectedEndpoint) return selectedEndpointGeometry()?.entity || null;
  return selectedRectangleForMetrics();
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
  if (!edit || edit.key !== key) return null;
  return isLinePoint(edit.point) ? edit.point : edit.lockedBySpen ? edit.end : null;
}

function clearLineMetricEdit() {
  if (state.numericEdit?.lineMetric) state.numericEdit = null;
  for (const input of lineMetricKinds.keys()) input?.removeAttribute("aria-invalid");
}

function closeMetricEntry() {
  const keyboardInput = numericConfirmInput(false);
  if (!keyboardInput && !steppedMetricInput) return;
  if (steppedMetricInput) {
    modifiedMetricInputs.delete(steppedMetricInput);
    steppedMetricInput = null;
    commitNumericInputEdit();
  }
  if (keyboardInput) {
    document.activeElement.blur();
    window.ZamerAndroid?.dismissKeyboard?.();
  }
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
  const axis = edit.lockedAngle === undefined && !edit.endpoint && state.tool === "line" && (edit.length > 0 || draft?.metricConstraint?.length > 0)
    ? lineAxisAngle(draft?.metricDirection, edit.start, rawCursorWorld()) : undefined;
  const angle = edit.angle ?? edit.lockedAngle ?? draft?.metricConstraint?.angle ?? axis ??
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
  const figure = figureMetricContext(input);
  if (figure) {
    if (state.numericEdit?.figureMetric === figure) return;
    commitNumericInputEdit();
    state.numericEdit = { figureMetric: { ...figure, point: null, texts: {}, values: {} } };
    return;
  }
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
  if (!edit || edit.lineMetric || edit.figureMetric) return;
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
  if (input !== document.activeElement && steppedMetricInput !== input) input.focus({ preventScroll: true });
  if (state.numericEdit?.figureMetric) {
    confirmFigureMetricInput(input, state.numericEdit.figureMetric);
    return;
  }
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
    if (apply(lineMetricKinds.get(input), { recordUndo: false }) === false) return;
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
  const rectangle = selectedRectangleForMetrics();
  if (rectangle) return applySelectedRectangleSize(rectangle, kind);
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

function applySelectedRectangleSize(entity, kind) {
  const width = kind === "angle";
  const input = width ? topAngleInput : topLengthInput;
  const length = readProjectLength(input);
  const start = width ? entity.y1 : entity.x1;
  const end = width ? entity.y2 : entity.x2;
  const next = start + Math.sign(end - start) * length;
  const geometry = width ? { y2: next } : { x2: next };
  if (!(length > linePointEpsilon) || !validFigurePiece({ ...entity, ...geometry })) {
    input.setAttribute("aria-invalid", "true");
    statusChip.textContent = "Введите положительный размер в пределах чертежа";
    return false;
  }
  input.removeAttribute("aria-invalid");
  if (geometryChanged(entity, geometry)) applyEntityGeometry(entity, geometry);
  statusChip.textContent = "Размер прямоугольника применён";
  draw();
  return true;
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
  const nextLength = kind === "length" && Number.isFinite(typedLength) && typedLength > 0 ? typedLength : currentLength;
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
  if (!entity || entities.some((item) => isLayerLocked(item.layer))) return;
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
  if (isLayerLocked(entity.layer)) return;
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
  if (action === "group") {
    toggleSelectionGroup();
    return;
  }
  if (action === "properties") {
    openObjectProperties(actionEntity);
    return;
  }
  if (action === "make-block") {
    void saveSelectedBlock(selected);
    return;
  }
  if (action === "explode") {
    const replacements = selected.map(entity => [entity, explodeEntity(entity)]);
    if (replacements.some(([, parts]) => !parts)) {
      statusChip.textContent = "Не удалось разложить геометрию в допустимых координатах";
      return;
    }
    const count = replacements.reduce((total, [, parts]) => total + parts.length, 0);
    const ids = commitLineEdit(replacements, `Разобрано · объектов: ${count}`, [], "preserve");
    if (!ids) return;
    setSelection(ids.filter(id => state.entities.some(entity => entity.id === id && isLayerVisible(entity.layer))));
    draw();
    return;
  }

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

  if (action === "rotate") {
    startMoveLikeCommand(selected, "rotate");
    return;
  }

  if (action === "mirror") {
    startLineEdit(action, selected[0], { sourceIds: selected.map(({ id }) => id) });
    return;
  }

  if (action === "fillet") {
    startLineEdit(action, selected[0], { filletIds: selected.map(({ id }) => id) });
    return;
  }

  if (!actionEntity) return;
  if (action === "mirror" || (action === "scale" && isReusableBlock(actionEntity)) || (isDraftLine(actionEntity) && lineOnlyEditActions.has(action)) ||
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
  }
}

function blockSourceEntity(entity) {
  return entity.layer !== TRACE_LAYER && !isLayerLocked(entity.layer) && (isReusableBlock(entity) || editableFigure(entity));
}

function applyBlockLibrary(blocks) {
  state.reusableBlocks = blocks;
  if (blockPaletteDialog.open) renderBlockPalette();
  markProjectDirty("block-library");
  draw();
}

function changeBlockLibrary(blocks) {
  state.undo.push({ type: "block-library", before: state.reusableBlocks, after: blocks });
  state.redo.length = 0;
  applyBlockLibrary(blocks);
}

async function saveSelectedBlock(selected) {
  const projectId = persistence.projectId;
  const id = newLineId("block-definition");
  const definition = createReusableBlockDefinition(id, "Блок", selected);
  if (!definition) {
    statusChip.textContent = "Выберите линии или фигуры, которые можно собрать в блок";
    return;
  }
  const knownNames = new Set(state.reusableBlocks.map(({ name }) => name.toLowerCase()));
  let number = 1;
  while (knownNames.has(`блок ${number}`)) number++;
  const response = await askProjectName("Создать блок", `Блок ${number}`, "Название блока");
  if (response === null || projectId !== persistence.projectId ||
      !selected.every(entity => state.entities.includes(entity) && blockSourceEntity(entity)) || state.reusableBlocks.length >= MAX_REUSABLE_BLOCKS) return;
  const name = normalizeBlockName(response);
  if (!name || state.reusableBlocks.some(block => block.name.toLowerCase() === name.toLowerCase())) {
    statusChip.textContent = name ? "Блок с таким названием уже есть" : "Укажите название блока";
    return;
  }
  changeBlockLibrary([...state.reusableBlocks, { ...definition, name }]);
  statusChip.textContent = `Блок «${name}» сохранён · Фигуры → Блоки`;
  canvas.focus({ preventScroll: true });
}

function renderBlockPalettePreview(definition) {
  const preview = document.createElement("span");
  preview.className = "block-palette-preview";
  preview.setAttribute("aria-hidden", "true");
  const sketch = buildBlockPreview(definition, { customLineLayers: state.customLineLayers, width: 144, height: 80 });
  if (!sketch) {
    preview.innerHTML = cadIcon("block");
    return preview;
  }
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", sketch.viewBox);
  svg.setAttribute("focusable", "false");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.5");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  for (const { d, color } of sketch.paths) {
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", d);
    path.setAttribute("vector-effect", "non-scaling-stroke");
    if (color) path.setAttribute("stroke", color);
    svg.append(path);
  }
  preview.append(svg);
  return preview;
}

function filterBlockPalette() {
  const query = blockPaletteSearchInput.value.normalize("NFC").trim().toLocaleLowerCase("ru-RU");
  let found = false;
  for (const item of blockPaletteList.children) {
    item.hidden = !item.dataset.blockSearch.includes(query);
    if (!item.hidden) found = true;
  }
  const empty = blockPaletteList.children.length === 0;
  document.getElementById("blockPaletteEmpty").hidden = !empty;
  document.getElementById("blockPaletteNoResults").hidden = empty || found;
  blockPaletteList.hidden = !found;
  blockPaletteSearchClear.hidden = !blockPaletteSearchInput.value;
  blockPaletteList.scrollTop = 0;
}

function setBlockPaletteSearch(open) {
  blockPaletteSearch.hidden = !open;
  blockPaletteSearchToggle.setAttribute("aria-expanded", String(open));
  if (!open) blockPaletteSearchInput.value = "";
}

function renderBlockPalette() {
  blockPaletteList.replaceChildren(...state.reusableBlocks.map(definition => {
    const item = document.createElement("li");
    item.className = "block-palette-card";
    item.dataset.blockSearch = definition.name.toLocaleLowerCase("ru-RU");
    const insert = document.createElement("button");
    insert.type = "button";
    insert.className = "block-palette-insert";
    insert.dataset.insertBlock = definition.id;
    insert.setAttribute("aria-label", `Вставить «${definition.name}»`);
    insert.title = definition.name;
    const caption = document.createElement("span");
    caption.className = "block-palette-caption";
    const name = document.createElement("small");
    name.className = "block-palette-name";
    name.textContent = definition.name;
    caption.append(name);
    insert.append(renderBlockPalettePreview(definition), caption);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "block-palette-remove";
    remove.dataset.removeBlock = definition.id;
    remove.setAttribute("aria-label", `Удалить из библиотеки «${definition.name}»`);
    remove.title = "Удалить из библиотеки";
    remove.innerHTML = cadIcon("delete");
    item.append(insert, remove);
    return item;
  }));
  filterBlockPalette();
}

function startBlockPlacement(definition) {
  const available = availableLineLayerIds();
  const layer = available.includes(state.activeLineLayer) ? state.activeLineLayer : available[0];
  blockPaletteDialog.close();
  if (!layer || definition.parts.some(part => isLayerLocked(part.layer))) {
    statusChip.textContent = "Разблокируйте слои блока перед вставкой";
    draw();
    return;
  }
  const preview = createReusableBlockInstance(definition, "block-preview", { x: 0, y: 0 }, layer);
  if (!preview) return;
  setTool("block-placement");
  state.blockPlacement = { definition, layer, preview };
  setSelection(null);
  statusChip.textContent = `Блок «${definition.name}» · укажите точку вставки`;
  canvas.focus({ preventScroll: true });
  draw();
}

function placeReusableBlock(point) {
  const { definition, layer } = state.blockPlacement;
  if (isLayerLocked(layer) || definition.parts.some(part => isLayerLocked(part.layer))) {
    setTool("select");
    statusChip.textContent = "Слой заблокирован";
    return;
  }
  const block = createReusableBlockInstance(definition, newLineId("block"), point, layer);
  if (!block) {
    statusChip.textContent = "Выберите точку вставки в пределах чертежа";
    return;
  }
  state.visibleLayers.add(layer);
  setTool("select");
  pushEntity(block);
  statusChip.textContent = `Блок «${definition.name}» вставлен`;
  draw();
}

function hideInlineEditors() {
  if (state.numericEdit?.lineMetric) closeLineMetricInput();
  else if (state.numericEdit?.figureMetric) cancelFigureMetricInput();
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
  if (state.leaderInput?.options) return state.leaderInput.options;
  if (state.tool === "text") return {
    textHeight: annotationPreferences.textHeight,
    leaderLine: "straight",
    leaderFrame: annotationPreferences.textFrame,
  };
  return {
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

function openLeaderInput(entity = null, point = null) {
  if (isLayerLocked(entity?.layer || "text")) return;
  if (state.leaderInput) return;
  const textInput = Boolean(point || entity?.type === "text");
  const appearance = entity?.dimensionKind === "leader" ? leaderAppearance(entity) : null;
  state.leaderInput = {
    entity, point,
    options: entity?.type === "text" ? { textHeight: Math.abs(entity.height || 260), leaderLine: "straight", leaderFrame: Boolean(entity.textFrame) }
      : entity ? { textHeight: leaderTextHeight(entity), leaderLine: appearance.line, leaderFrame: appearance.frame }
        : point ? { textHeight: annotationPreferences.textHeight, leaderLine: "straight", leaderFrame: annotationPreferences.textFrame } : null,
  };
  const label = textInput ? "Текст надписи" : "Текст выноски";
  leaderUi.editor.setAttribute("aria-label", label);
  leaderUi.text.setAttribute("aria-label", label);
  leaderUi.text.placeholder = label;
  for (const [button, action] of [
    [leaderUi.apply, textInput ? "Сохранить надпись" : "Сохранить выноску"],
    [leaderUi.cancel, textInput ? "Отменить ввод текста" : "Отменить ввод выноски"],
  ]) {
    button.title = action;
    button.setAttribute("aria-label", action);
  }
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
  window.setTimeout(processNativeImports, 0);
}

function finishLeaderInput(save) {
  const input = state.leaderInput;
  if (!input) return;
  const textInput = Boolean(input.point || input.entity?.type === "text");
  if (save && isLayerLocked(input.entity?.layer || "text")) {
    leaderUi.error.textContent = layerLockMessage(input.entity?.layer || "text");
    return;
  }
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
      leaderUi.error.textContent = textInput ? "Введите надпись" : "Введите текст выноски";
      leaderUi.text.setAttribute("aria-invalid", "true");
      leaderUi.text.focus({ preventScroll: true });
      syncLeaderInputPosition();
      return;
    }
    const values = { ...leaderToolOptions(), text };
    if (input.point) {
      const entity = textEntity(newLineId("text"), input.point.x, input.point.y, text, values.textHeight);
      entity.layer = "text";
      entity.textFrame = Boolean(values.leaderFrame);
      pushEntity(entity);
      rememberAnnotationSettings(["text"], values);
    } else if (input.entity?.type === "text" && state.entities.includes(input.entity)) {
      editTextProperties(input.entity, values);
      rememberAnnotationSettings(["text"], values);
    } else {
      if (input.entity && state.entities.includes(input.entity)) editLeaderProperties(input.entity, values);
      else if (!input.entity && draft?.phase === "leader-text") {
        pushEntity(leaderEntity(newLineId("leader"), draft.start, draft.end, text, { ...values, leaderElbow: draft.elbow }));
      }
      rememberAnnotationSettings(["leader"], values);
    }
  }
  if (!input.entity) state.drawing = null;
  closeLeaderInput();
  resetSnapTracking();
  if (input.point) statusChip.textContent = save ? "Текст поставлен. Можно добавить ещё надпись" : "Текст: укажите место надписи";
  else if (textInput) statusChip.textContent = save ? "Текст изменён" : "Правка текста отменена";
  else statusChip.textContent = input.entity ? (save ? "Выноска изменена" : "Правка выноски отменена") : leaderPlacementHint();
  canvas.focus({ preventScroll: true });
  draw();
}

function editLeaderProperties(entity, values) {
  if (isLayerLocked(entity.layer)) return;
  const { line, frame } = leaderAppearance(entity);
  const current = { text: decodeMojibakeText(entity.text || ""), textHeight: leaderTextHeight(entity), leaderLine: line, leaderFrame: frame };
  const after = Object.fromEntries(Object.entries(values).filter(([key, value]) => current[key] !== value));
  if (!Object.keys(after).length) return;
  const before = Object.fromEntries(Object.keys(after).map((key) => [key, entity[key]]));
  recordAnnotationEdits([{ entityId: entity.id, before, after }]);
}

function editTextProperties(entity, values) {
  if (isLayerLocked(entity.layer)) return;
  const current = { text: decodeMojibakeText(entity.text || ""), textHeight: Math.abs(entity.height || 260),
    leaderFrame: Boolean(entity.textFrame) };
  const mapped = { text: values.text, height: values.textHeight, textFrame: Boolean(values.leaderFrame) };
  const before = {};
  const after = {};
  for (const [key, value] of Object.entries(mapped)) {
    const currentKey = key === "height" ? "textHeight" : key === "textFrame" ? "leaderFrame" : key;
    if (current[currentKey] === value) continue;
    before[key] = entity[key];
    after[key] = value;
  }
  if (Object.keys(after).length) recordAnnotationEdits([{ entityId: entity.id, before, after }]);
}

function editTextEntity(entity) {
  if (entity?.type !== "text") return;
  openLeaderInput(entity);
}

function createTextAtPoint(point) {
  statusChip.textContent = "Текст: введите надпись";
  openLeaderInput(null, point);
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
  if (state.drawing || state.moveCommand?.base || state.offsetCommand || state.pinch || planZoneSnapStart() || state.planZone?.mode === "existing") return false;
  if (state.pointer && state.pointer.mode !== "pan") return false;
  return trackingDrawingTools.has(state.tool) || Boolean(state.moveCommand) || lineEditPlacesPoint() ||
    Boolean(state.blockPlacement) || state.tool === "text";
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
  if (state.lineEdit?.mode === "mirror" && state.lineEdit.mirrorStart) return state.lineEdit.mirrorStart;
  return selectedEndpointGeometry()?.fixed || rectangleGripReference()?.start || null;
}

function updateSnapTrackingHover() {
  if (!canCreateSnapTrackingPoint()) {
    clearSnapTrackingHover();
    state.snapTracking.active = null;
    return;
  }
  const raw = rawCursorWorld();
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
  const current = nearestTrackingAnchorCandidate(rawCursorWorld());
  const currentKey = current ? trackingPointKey(current) : null;
  const stillNearOriginal = distanceWorld(rawCursorWorld(), point) <= trackingActivationThreshold();
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

function nearbyExtensionTrackingGuides(point, threshold) {
  if (!snapEnabled("extension")) return [];
  const excluded = state.selectedEndpoint?.entityId || state.selectedFigureGrip?.entityId || state.pointer?.grip?.entityId;
  const guides = [];
  for (const boundary of boundarySegments(excluded)) {
    if (boundary?.type === "arc" || boundary?.type === "circle") continue;
    const dx = boundary.x2 - boundary.x1;
    const dy = boundary.y2 - boundary.y1;
    const length = Math.hypot(dx, dy);
    if (!(length > linePointEpsilon)) continue;
    const extension = nearestLineExtension(point, [boundary], threshold);
    if (!extension) continue;
    guides.push({
      point: { x: boundary.x1, y: boundary.y1 },
      angle: Math.atan2(dy, dx),
      ux: dx / length,
      uy: dy / length,
      boundary,
      length,
      isExtension: true,
      distance: distanceWorld(point, extension),
    });
  }
  guides.sort((a, b) => a.distance - b.distance);
  return guides.slice(0, 12);
}

function nearestCompoundTrackingSnap(point, start) {
  const threshold = objectSnapThreshold();
  const locked = state.snapTracking.compoundLock;
  if (locked && distanceWorld(point, locked) * state.view.scale <= 32) {
    const visibleGuides = locked.guides.filter(guide => !guide.isPolar);
    state.snapTracking.active = visibleGuides.length ? { trackingType: "intersection", guides: visibleGuides } : null;
    const polarGuide = locked.guides.find(guide => guide.isPolar);
    if (polarGuide) {
      const degrees = Math.round(normalizeDegrees(-radToDeg(polarGuide.angle))) % 360;
      state.polarSnapGuide = { point: start, angle: polarGuide.angle, degrees };
    }
    return locked;
  }
  state.snapTracking.compoundLock = null;
  const polarGuides = start && snapEnabled("polar") ? polarRayGuides(start, state.polarStep) : [];
  const trackingGuides = canSnapToTrackingGuides() ? snapTrackingGuides() : [];
  const extensionGuides = nearbyExtensionTrackingGuides(point, threshold);
  const pairs = [];
  for (const polarGuide of polarGuides) {
    for (const guide of [...trackingGuides, ...extensionGuides]) pairs.push([polarGuide, guide]);
  }
  for (const tracking of trackingGuides) {
    for (const extension of extensionGuides) pairs.push([tracking, extension]);
  }

  const crossing = nearestCompoundGuideIntersection(point, pairs, threshold);
  if (!crossing) return null;
  const snap = {
    ...crossing,
    type: "intersection",
    label: "Пересечение отслеживания",
    compoundTracking: true,
    compoundPolar: crossing.guides.some(guide => guide.isPolar),
  };
  state.snapTracking.compoundLock = snap;
  const visibleGuides = snap.guides.filter(guide => !guide.isPolar);
  state.snapTracking.active = visibleGuides.length ? { trackingType: "intersection", guides: visibleGuides } : null;
  const selectedPolar = snap.guides.find(guide => guide.isPolar);
  if (selectedPolar) {
    const degrees = Math.round(normalizeDegrees(-radToDeg(selectedPolar.angle))) % 360;
    state.polarSnapGuide = { point: start, angle: selectedPolar.angle, degrees };
  }
  return snap;
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
  state.snapTracking.compoundLock = null;
  state.polarSnapGuide = null;
  state.polarSnapLock = null;
  state.lastCursorPreview = null;
  if (state.pointer) state.pointer.confirmedSnap = null;
  state.dimensionSnapChoice = null;
}

function drawCursorSnap(c) {
  const dimensionStage = state.tool === "dimension" && !surveyPointPicker && !state.leaderInput ? state.drawing?.phase : null;
  const chooseAxis = state.dimensionTool === "linear" && dimensionStage === "offset";
  const selectOnly = state.tool === "select" && !state.moveCommand && !state.selectedEndpoint && !state.selectedFigureGrip && !state.dimensionAttach &&
    !surveyPointPicker && !lineEditPlacesPoint() && !state.blockPlacement && !state.quickMeasure;
  const resolved = selectOnly || state.leaderInput ? null : cursorSnapResolved();
  if (spenCursorActive() || !spenModeEnabled()) {
    state.lastCursorPreview = resolved?.snap && !state.snapsMuted ? {
      resolved: { ...resolved, point: { ...resolved.point }, snap: { ...resolved.snap } },
      screen: { ...inputCursorScreen() }, pen: spenCursorActive(), context: cursorPreviewContext(),
      tracking: state.snapTracking.active, polar: state.polarSnapGuide,
    } : null;
  }
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
  if (type === "tracking" || snap.compoundTracking) drawSnapTracking(c);
  if (type === "polar" || snap.compoundPolar) drawPolarSnapGuide(c);
  if (isLineSnapContext() &&
      (type === "tracking" || type === "polar")) return;
  const point = worldToScreen(snap);
  if (type === "extension") {
    const anchor = worldToScreen(snap.anchor);
    ctx.save();
    ctx.strokeStyle = c.accent;
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = 1.4;
    ctx.setLineDash([5, 4]);
    linePath(anchor.x, anchor.y, point.x, point.y);
    ctx.restore();
  }
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

function extensionSnap(point, boundaries) {
  const draft = state.tool === "polyline" ? state.drawing : null;
  const previous = draft?.points.at(-2);
  const last = draft?.points.at(-1);
  const straight = previous && !draft.bulges.at(-1);
  const segments = straight ? [{ x1: previous.x, y1: previous.y, x2: last.x, y2: last.y }, ...boundaries] : boundaries;
  return nearestLineExtension(point, segments, nearestSegmentSnapThreshold(), { intersect: snapEnabled("intersection") });
}

function isLineSnapContext() {
  return trackingDrawingTools.has(state.tool) || state.planZone?.mode === "contour" || isDraftLine(selectedEndpointGeometry()?.entity) || Boolean(state.selectedFigureGrip) ||
    ["line-grip", "figure-grip"].includes(state.pointer?.mode) || lineEditPlacesPoint() || Boolean(state.moveCommand || state.offsetCommand || state.blockPlacement) ||
    state.tool === "text";
}

function nearbyDraftLineSnaps(point, start) {
  const perpendicular = start && snapEnabled("perpendicular");
  const intersection = snapEnabled("intersection");
  if (!perpendicular && !intersection) return [];
  const threshold = objectSnapThreshold();
  const excluded = state.selectedEndpoint?.entityId || state.selectedFigureGrip?.entityId || state.pointer?.grip?.entityId;
  const boundaries = boundarySegments(excluded);
  return [
    ...(intersection ? nearbyIntersections(point, boundaries, threshold) : []),
    ...(perpendicular ? nearbyPerpendiculars(point, start, boundaries, threshold) : []),
  ];
}

function polarExtensionConflict(point, start, extension) {
  if (!start || !extension?.anchor || !snapEnabled("polar")) return false;
  const polar = snapPolar(point, start);
  if (!polar.snapped) return false;
  const dx = extension.x - extension.anchor.x;
  const dy = extension.y - extension.anchor.y;
  const length = Math.hypot(dx, dy);
  if (!(length > linePointEpsilon)) return false;
  return guideDirectionsParallel(
    { ux: dx / length, uy: dy / length },
    { ux: Math.cos(polar.angle), uy: Math.sin(polar.angle) },
  );
}

function nearestObjectSnap(point, { includeNearestSegment = false, start = null, includeExtension = true,
  suppressPolarExtension = false } = {}) {
  if (state.snapsMuted) return null;
  const objectThreshold = objectSnapThreshold();
  const midpointThreshold = midpointSnapThreshold();
  const nearestThreshold = nearestSegmentSnapThreshold();
  const lineContext = isLineSnapContext();
  const excluded = lineContext ? state.selectedEndpoint?.entityId || state.selectedFigureGrip?.entityId || state.pointer?.grip?.entityId : null;
  const candidates = nearbyDraftLineSnaps(point, start);
  candidates.push(...snapCandidates({ includeCorners: snapEnabled("end"), includeMidpoints: snapEnabled("mid"),
    includeCenters: snapEnabled("center"), excludeId: excluded }));
  const eligible = candidates.filter((item) => {
    const threshold = item.snapRole === "mid" || item.snapRole === "center" ? midpointThreshold : objectThreshold;
    return distanceWorld(point, item) < threshold;
  });
  const candidate = preferredSnapCandidate(point, eligible, state.view.scale);
  if (candidate) return candidate;
  const fallback = [];
  if (includeExtension && snapEnabled("extension")) {
    const extension = extensionSnap(point, boundarySegments(excluded));
    if (extension && !(suppressPolarExtension && polarExtensionConflict(point, start, extension))) fallback.push(extension);
  }
  if (includeNearestSegment && snapEnabled("nearest")) {
    const nearest = lineContext
      ? nearestBoundaryPoint(point, boundarySegments(excluded), nearestThreshold)
      : nearestPointOnDrawableSegment(point, nearestThreshold, excluded);
    if (nearest) fallback.push(nearest);
  }
  return preferredSnapCandidate(point, fallback, state.view.scale);
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
  if (!entity || entity.type !== "circle" || isLayerLocked(entity.layer)) return;
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
  return Math.min(MAX_VIEW_SCALE, Math.max(MIN_VIEW_SCALE, scale));
}

function viewportScaleLabel() {
  const percent = state.view.scale / DEFAULT_VIEW_SCALE * 100;
  const value = Number(percent.toFixed(percent < 10 ? 2 : 0));
  return `${String(value).replace(".", ",")}%`;
}

function snapEnabled(mode) {
  return !state.snapsMuted && state.snaps.has(mode);
}

function visibleGridStep() {
  const minimum = 6 / state.view.scale;
  let decade = state.gridStep;
  while (decade * 10 < minimum) decade *= 10;
  return decade * [1, 2, 5, 10].find((factor) => decade * factor >= minimum);
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
  viewportActionStatus.textContent = `Масштаб вида: ${viewportScaleLabel()}`;
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
  if (additionalDimensionKinds.includes(entity.dimensionKind)) return boundsFromViewportPoints(selectionEntityPoints(entity));
  if (isRadialDimension(entity)) {
    const art = radialDimensionArtwork(entity, state.annotationScale);
    return art ? boundsFromViewportPoints([art.start, art.end, art.label]) : null;
  }
  if (entity.dimensionKind === "angular") return angularDimensionBounds(entity);
  if (entity.dimensionKind === "leader") return boundsFromViewportPoints(leaderSelectionGeometry(entity).points);
  if (isPlanAnnotationZone(entity)) return planAnnotationGeometry(entity)?.bounds;
  if (entity.type === "polyline") return polylineBounds(entity);
  if (isReusableBlock(entity)) return reusableBlockBounds(entity);
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
  if (entity.revisionCloud) return "Облако изменений";
  if (isReusableBlock(entity)) return `Блок · ${entity.name || "Без названия"}`;
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
  const entity = state.entities.find((item) => item.id === id && isLayerVisible(item.layer) && traceMatchesEditingContext(item));
  if (!entity) return false;
  const bounds = viewportEntityBounds(entity);
  if (!bounds || !Object.values(bounds).every(Number.isFinite)) return false;
  setTool("select");
  const locked = isLayerLocked(entity.layer);
  setSelection(locked ? null : id);
  centerViewOnWorldPoint({ x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 });
  viewportActionStatus.textContent = locked ? layerLockMessage(entity.layer || DEFAULT_LINE_LAYER) : `На чертеже выбран объект «${label}»`;
  canvas.focus({ preventScroll: true });
  draw();
  return true;
}

function openViewportObjects() {
  const objects = state.entities.filter((entity) => isLayerVisible(entity.layer) && traceMatchesEditingContext(entity)).map((entity) => {
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

function centerOpeningView() {
  const bounds = state.entities.filter(entity => isLayerVisible(entity.layer)).map(viewportEntityBounds)
    .filter(extent => extent && Object.values(extent).every(Number.isFinite));
  const rect = canvas.getBoundingClientRect();
  const bottom = canvas.parentElement.querySelector(".tool-rail").getBoundingClientRect().top - rect.top;
  const hasDrawingInView = () => {
    const topLeft = screenToWorld({ x: 0, y: 32 });
    const bottomRight = screenToWorld({ x: rect.width, y: bottom });
    return bounds.some(({ minX, maxX, minY, maxY }) =>
      maxX >= topLeft.x && minX <= bottomRight.x && maxY >= topLeft.y && minY <= bottomRight.y);
  };
  const savedView = { ...state.view };
  centerViewOnWorldPoint(projectOrigin);
  if (!bounds.length || hasDrawingInView()) return;

  state.view = savedView;
  if (!hasDrawingInView()) fitViewport();
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
  const topPanels = [...canvas.parentElement.querySelectorAll(".draw-tool-menu:not(#drawToolMenu, #annotationToolMenu), .line-command-panel, .plan-annotation-actions, .dimension-assist, .corner-metrics, .quick-measure-panel")]
    .filter(panel => panel.getClientRects().length);
  const availableTop = Math.max(38, ...topPanels.map((panel) => panel.getBoundingClientRect().bottom - rect.top)) + 18;
  const bottomPanels = [shell.querySelector(".tool-rail"), drawToolMenu, annotationToolMenu].filter(panel => panel.getClientRects().length);
  const availableBottom = Math.min(rect.height, ...bottomPanels.map(panel => panel.getBoundingClientRect().top - rect.top)) - 18;
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
    else pickLineEditPoint(inputCursorScreen());
  } else if (viewportIsSelecting()) {
    applyTapSelection(pickEntity(inputCursorScreen()));
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
    statusChip.textContent = `Масштаб ${viewportScaleLabel()}`;
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
  const { start, arcEnd: end } = draft;
  const chord = distanceWorld(start, end);
  if (chord < 1) return resolveSnapWorld(point);
  const mid = midpoint(start, end);
  const ux = (end.x - start.x) / chord;
  const uy = (end.y - start.y) / chord;
  const nx = -uy;
  const ny = ux;
  const rawSagitta = (point.x - mid.x) * nx + (point.y - mid.y) * ny;
  const polarEnabled = snapEnabled("polar");
  const segments = polarEnabled ? drawableSnapSegments() : [];
  const previous = polarEnabled ? draft.points?.at(-2) : null;
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

  const fallback = connected ? resolveSnapWorld(point, { polarStart: null })
    : resolveLineLikeSnap(point, mid, { useOrtho: false });
  const anchor = fallback.snap && !["grid", "tracking", "polar"].includes(fallback.snap.type);
  if (anchor) {
    const arc = arcGeometry(start, fallback.point, end);
    if (isLinePoint(arc?.center) && arc.radius <= MAX_LINE_COORDINATE) {
      const sign = arc.counterClockwise ? 1 : -1;
      const sweep = normalizeAnglePositive((arc.endAngle - arc.startAngle) * sign);
      const sagitta = -sign * chord * Math.tan(sweep / 4) / 2;
      const through = { x: mid.x + nx * sagitta, y: mid.y + ny * sagitta };
      if (isLinePoint(through)) return { ...fallback, point: through };
    }
  }
  if (!best || anchor) return fallback;
  state.snapTracking.active = null;
  state.polarSnapGuide = { point: best.anchor, angle: best.angle };
  return snappedPoint(best.point, "polar");
}

function resolveSnapWorld(point, { polarStart = state.drawing?.start || state.moveCommand?.base } = {}) {
  const trackingThreshold = objectSnapThreshold();
  state.snapTracking.active = null;
  state.polarSnapGuide = null;
  const objectSnap = nearestObjectSnap(point, {
    includeNearestSegment: isLineSnapContext(),
    start: state.drawing?.arcEnd && midpoint(state.drawing.start, state.drawing.arcEnd),
  });
  if (objectSnap) {
    state.polarSnapLock = null;
    return { point: { x: objectSnap.x, y: objectSnap.y }, snap: objectSnap };
  }
  if (canSnapToPrePointTrackingGuides() || canUseSnapTracking()) {
    const snap = nearestSnapTrackingPoint(point, trackingThreshold);
    if (snap) {
      state.polarSnapLock = null;
      state.snapTracking.active = snap;
      return { point: { x: snap.x, y: snap.y }, snap };
    }
  }
  return resolveGridAndPolarSnap(point, state.drawing?.phase === "offset" ? null : polarStart);
}

function resolveGridAndPolarSnap(point, start, useGrid = true) {
  state.polarSnapGuide = null;
  const grid = useGrid && snapEnabled("grid");
  const fallback = grid ? gridPoint(point) : point;
  if (start && snapEnabled("polar")) {
    const polar = snapPolar(fallback, start, { remember: true });
    if (polar.snapped) {
      state.polarSnapGuide = { point: start, angle: polar.angle, degrees: polar.degrees };
      return snappedPoint(polar.point, "polar");
    }
  }
  state.polarSnapLock = null;
  return grid ? snappedPoint(fallback, "grid") : { point, snap: null };
}

function dimensionCursorSnap(raw) {
  const mode = state.dimensionTool;
  const draft = state.drawing;
  if (draft?.phase === "offset") return resolveGridAndPolarSnap(raw, draft.end, false);
  if (mode === "radial") return resolveGridAndPolarSnap(raw, radialSourceGeometry()?.center, false);

  const detail = state.additionalDimensionDraft;
  if (!detail) return resolveDimensionPointSnap(raw);
  const first = { x: detail.x1, y: detail.y1 };
  if (mode === "rotated" && detail.measureAngle == null) return resolveDimensionPointSnap(raw, { start: first });
  const base = mode === "arc-length" ? arcGeometry(detail.arcStart, detail.arcThrough, detail.arcEnd)?.center
    : detail.jogCenter ?? detail.measureEnd ?? first;
  return resolveGridAndPolarSnap(raw, base, false);
}

function resolveDimensionPointSnap(point, { start = state.drawing?.start } = {}) {
  state.snapTracking.active = null;
  state.polarSnapGuide = null;
  const threshold = objectSnapThreshold();
  const useIntersection = snapEnabled("intersection");
  const usePerpendicular = start && snapEnabled("perpendicular");
  const useExtension = snapEnabled("extension");
  const useNearest = snapEnabled("nearest");
  const boundaries = (useIntersection || usePerpendicular || useExtension || useNearest) ? boundarySegments() : [];
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
  const extension = useExtension ? extensionSnap(point, boundaries) : null;
  if (extension) candidates.push(extension);
  if (useNearest) candidates.push(...nearbyBoundaryPoints(point, boundaries, nearestSegmentSnapThreshold()));
  candidates.sort((first, second) => snapCandidateScore(point, first, state.view.scale) - snapCandidateScore(point, second, state.view.scale));
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
  if (snap) {
    state.polarSnapLock = null;
    return { point: { x: snap.x, y: snap.y }, snap, snapCount: distinct.length, snapIndex };
  }
  return resolveGridAndPolarSnap(point, leaderToolActive() ? null : start);
}

function resolveLineLikeSnap(point, start, { useGrid = true, useOrtho = true } = {}) {
  state.snapTracking.active = null;
  state.polarSnapGuide = null;

  const ortho = useOrtho && isLineSnapContext() && snapEnabled("ortho");
  const grid = useGrid && snapEnabled("grid");
  const objectSnap = nearestObjectSnap(point, { includeNearestSegment: false, start, includeExtension: false });
  if (objectSnap) {
    state.polarSnapLock = null;
    state.snapTracking.compoundLock = null;
    return { point: { x: objectSnap.x, y: objectSnap.y }, snap: objectSnap };
  }
  if (ortho) {
    state.polarSnapLock = null;
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
  const compound = nearestCompoundTrackingSnap(point, start);
  if (compound) {
    state.polarSnapLock = null;
    return { point: { x: compound.x, y: compound.y }, snap: compound };
  }
  let tracking = null;
  if (canSnapToTrackingGuides()) {
    const threshold = objectSnapThreshold();
    tracking = nearestSnapTrackingPoint(point, threshold, start) ?? nearestSnapTrackingPoint(point, threshold);
  }

  const lineSnap = nearestObjectSnap(point, { includeNearestSegment: true, start, includeExtension: true, suppressPolarExtension: true });
  const assisted = preferredSnapCandidate(point, [tracking, lineSnap].filter(Boolean), state.view.scale);
  if (assisted) {
    state.polarSnapLock = null;
    if (assisted === tracking) state.snapTracking.active = tracking;
    return { point: { x: assisted.x, y: assisted.y }, snap: assisted };
  }

  return resolveGridAndPolarSnap(point, start, useGrid);
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
    if (entity.id === excludeId || !isLayerVisible(entity.layer) || entity.layer === "dimensions" || !traceIsReference(entity)) continue;
    for (const point of objectPointRefs(entity)) {
      if (point.blockLayer && !isLayerVisible(point.blockLayer)) continue;
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
  if (!entity || isLayerLocked(entity.layer)) {
    cancelDimensionAttach();
    return;
  }
  const snap = cursorSnapResolved().snap;
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
    if (!isLinearDimension(entity) || isLayerLocked(entity.layer)) continue;
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
  if (isReusableBlock(entity)) {
    const transform = reusableBlockTransform(entity);
    return [{ x: entity.x, y: entity.y, pointKey: "center", snapRole: "center" },
      ...entity.parts.flatMap((part, index) => objectPointRefs(part).map(ref => ({ ...ref, ...transform(ref),
        pointKey: `part-${index}-${ref.pointKey}`, blockLayer: part.layer || DEFAULT_LINE_LAYER })))];
  }
  if (entity.type === "polyline") {
    const refs = entity.points.map((point, index) => ({ ...point, pointKey: `vertex-${index}`, snapRole: "end" }));
    for (const [index, { p1, p2, arc }] of polylineSegments(entity).entries()) {
      refs.push({ ...(arc?.through ?? midpoint(p1, p2)), pointKey: `mid-${index}`, snapRole: "mid" });
      if (arc) refs.push({ ...arc.center, pointKey: `arc-center-${index}`, snapRole: "center" });
    }
    return refs;
  }
  if (isPlanAnnotationZone(entity)) return planAnnotationSnapGeometry(entity).points;
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
  const scale = isReusableBlock(entity) ? entity.scale ?? 1 : 1;
  const w = size.width * scale;
  const h = size.height * scale;
  return [
    transformBlockPoint(entity, -w / 2, -h / 2),
    transformBlockPoint(entity, w / 2, -h / 2),
    transformBlockPoint(entity, w / 2, h / 2),
    transformBlockPoint(entity, -w / 2, h / 2),
  ];
}

function snapPolar(point, start, { remember = false } = {}) {
  const lock = state.polarSnapLock;
  const lockedAngle = lock?.step === state.polarStep && lock.x === start.x && lock.y === start.y ? lock.angle : null;
  const result = resolvePolarSnap(point, start, state.polarStep, lockedAngle);
  if (remember) state.polarSnapLock = result.snapped ? { x: start.x, y: start.y, step: state.polarStep, angle: result.angle } : null;
  return result;
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
    if (!isLayerVisible(entity.layer) || entity.layer === "dimensions" || entity.type === "block" || !traceIsReference(entity)) continue;
    if (entity.type === "line" || entity.type === "wall") {
      segments.push({ p1: { x: entity.x1, y: entity.y1 }, p2: { x: entity.x2, y: entity.y2 }, entity });
    } else if (entity.type === "polyline") {
      for (const segment of polylineSegments(entity)) segments.push({ ...segment, entity });
    } else if (entity.type === "rectangle") {
      const corners = rectangleCorners(entity);
      for (let i = 0; i < corners.length; i += 1) {
        segments.push({ p1: corners[i], p2: corners[(i + 1) % corners.length], entity });
      }
    } else if (isPlanAnnotationZone(entity)) {
      for (const segment of planAnnotationSnapGeometry(entity).segments) segments.push({ ...segment, entity });
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
          ? ["text", "revision-cloud"].includes(state.tool) || state.traceOptions || Boolean(state.planZone) ||
            (state.tool === "dimension" && state.dimensionTool === "leader")
          : buttonTool === state.tool && (buttonTool !== "dimension" || state.dimensionTool !== "leader");
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  escapeSelectButton?.setAttribute("aria-pressed", String(selecting && state.selectTool === "select"));
  const figure = state.tool !== "line" && isGroupedDrawTool(state.tool) ? drawToolButtonVisuals[state.tool] : null;
  figureToolButton?.classList.toggle("active", Boolean(figure));
  figureToolButton?.setAttribute("aria-label", figure ? `Фигуры: ${figure.label}` : "Фигуры");
}

function setTool(tool) {
  state.selectionPickCycle = null;
  if (pendingCanvasTap) {
    cancelPendingCanvasTap();
    state.pointer = null;
    if (tapZoom) {
      tapZoom = null;
      state.gestureSuppressTap = true;
    }
  }
  window.clearTimeout(state.pointer?.selectionHoldTimer);
  state.lastAnnotationTap = null;
  if (lineMetricContext()) closeLineMetricInput();
  else if (steppedMetricInput) closeMetricEntry();
  if (state.tool === "polyline" && state.drawing) finishLineCommand();
  closeLeaderInput();
  if (state.traceEditing && !traceTools.has(tool)) setTraceEditing(false);
  state.traceOptions = false;
  state.directManipulationIds.clear();
  state.blockPlacement = null;
  if (tool !== "quick-measure" && state.quickMeasure) {
    state.quickMeasure = null;
    syncQuickMeasure();
  }
  state.tool = tool;
  state.angleSide = null;
  state.radialSource = null;
  state.additionalDimensionDraft = null;
  copyToolMenu.hidden = true;
  state.copyPicking = null;
  state.actionPicking = null;
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
  if (["line", "polyline", "circle", "arc", "rectangle", "dimension", "text", "area", "elevation", "revision-cloud"].includes(tool)) {
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
  syncDrawToolMenu();
  syncToolButtons();
  const copy = {
    line: "Линия · первая точка",
    polyline: "Полилиния · первая точка",
    circle: circleConstructionHint(),
    arc: "Дуга · первая точка",
    rectangle: "Прямоугольник · первый угол",
    text: "Укажите место надписи",
    area: "Площадь · первая точка или готовый контур",
    elevation: "Высота Z · первая точка или готовый контур",
    "revision-cloud": revisionCloudPrompt(),
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
  if (numericStepSelect.value !== String(state.numericStep)) numericStepSelect.value = String(state.numericStep);
}

function syncDrawToolMenu() {
  drawToolButtons.forEach((button) => {
    const selected = button.dataset.drawTool === state.tool;
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
    const active = tool === "leader" ? state.tool === "dimension" && state.dimensionTool === "leader"
      : tool === "trace" ? state.traceEditing || state.traceOptions : state.tool === tool;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function syncSelectToolMenu() {
  let hasCommands = false;
  for (const button of selectionCommandButtons) {
    const available = canApplySelectionAction(button.dataset.action);
    button.disabled = button.hidden = !available;
    if (button.dataset.action === "group" && available) {
      const grouped = Boolean(selectedCommonGroupId(selectedEntities().filter((entity) => isLayerVisible(entity.layer))));
      button.title = grouped ? "Разгруппировать выбранное" : "Сгруппировать выбранное";
      button.setAttribute("aria-label", button.title);
      button.querySelector("small").textContent = grouped ? "Разгрупп." : "Группа";
    }
    if (available) hasCommands = true;
  }
  return hasCommands;
}

function prepareToolbarMenu(menu) {
  if (state.quickMeasure) setTool("select");
  if (menu !== drawToolMenu) hideDrawToolMenu();
  if (menu !== dimensionToolMenu) hideDimensionToolMenu();
  if (menu !== annotationToolMenu) hideAnnotationToolMenu();
  hideSelectToolMenu();
  hideSelectModeMenu();
}

function showDrawToolMenu() {
  if (!drawToolMenu) return;
  snapMore.open = false;
  prepareToolbarMenu(drawToolMenu);
  syncDrawToolMenu();
  drawToolMenu.hidden = false;
  figureToolButton?.setAttribute("aria-expanded", "true");
}

function hideDrawToolMenu() {
  if (drawToolMenu) drawToolMenu.hidden = true;
  figureToolButton?.setAttribute("aria-expanded", "false");
}

function showDimensionToolMenu() {
  if (!dimensionToolMenu) return;
  prepareToolbarMenu(dimensionToolMenu);
  syncDimensionToolMenu();
  dimensionToolMenu.hidden = false;
  tools.find((button) => button.dataset.tool === "dimension")?.setAttribute("aria-expanded", "true");
}

function hideDimensionToolMenu() {
  if (dimensionToolMenu) dimensionToolMenu.hidden = true;
  tools.find((button) => button.dataset.tool === "dimension")?.setAttribute("aria-expanded", "false");
}

function showAnnotationToolMenu() {
  if (!annotationToolMenu) return;
  prepareToolbarMenu(annotationToolMenu);
  syncAnnotationToolMenu();
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
  if (!isGroupedDrawTool(tool)) return;
  hideDrawToolMenu();
  setTool(tool);
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
  if (tool === "trace") {
    activatePlainSelect();
    state.traceOptions = true;
    statusChip.textContent = state.traceEditing ? "Правка пометок" : "Пометки поверх чертежа";
    draw();
    return;
  }
  if (tool === "leader") {
    state.dimensionTool = "leader";
    setTool("dimension");
    canvas.focus({ preventScroll: true });
    return;
  }
  setTool(tool);
  syncAnnotationToolMenu();
}

function revisionCloudPrompt() {
  if (state.revisionCloudMode === "rectangle") {
    return state.drawing ? "Облако · противоположный угол" : "Облако · первый угол";
  }
  const count = state.drawing?.points?.length ?? 0;
  return count < 3 ? "Облако · укажите минимум три вершины" : "Облако · следующая вершина или «Замкнуть»";
}

function syncRevisionCloudControls() {
  const active = state.tool === "revision-cloud" && annotationToolMenu.hidden && drawToolMenu.hidden && !snapMore.open;
  revisionCloudControls.hidden = !active;
  if (!active) return;
  const contour = state.revisionCloudMode === "contour";
  revisionCloudFinish.hidden = !contour || (state.drawing?.points.length ?? 0) < 3;
  for (const button of revisionCloudControls.querySelectorAll("[data-revision-cloud-mode]")) {
    const selected = button.dataset.revisionCloudMode === state.revisionCloudMode;
    button.disabled = !selected && Boolean(state.drawing);
    button.setAttribute("aria-pressed", String(selected));
  }
}

function revisionCloudAtCursor(point) {
  const draft = state.drawing;
  const corners = state.revisionCloudMode === "rectangle" ? revisionCloudRectangle(draft.points[0], point)
    : !point || distanceWorld(draft.points.at(-1), point) <= linePointEpsilon ||
      distanceWorld(draft.points[0], point) <= linePointEpsilon ? draft.points : [...draft.points, point];
  return createRevisionCloud("revision-preview", corners, draft.arcLength, state.traceEditing ? TRACE_LAYER : "text");
}

function drawRevisionCloudDraft(c) {
  const point = cursorWorld();
  const preview = revisionCloudAtCursor(point);
  if (preview) drawPolyline(preview, c, true);
  else {
    drawPolyline(state.drawing, c, true, true);
    drawEditableSegment(state.drawing.points.at(-1), point, c, { dashed: true, showHandles: true });
  }
}

function commitRevisionCloud(point) {
  const entity = revisionCloudAtCursor(point);
  if (!entity) {
    statusChip.textContent = "Облако · нужен замкнутый контур без пересечений";
    return;
  }
  entity.id = newLineId("revision-cloud");
  if (!pushEntity(entity, { select: false })) return;
  state.drawing = null;
  resetSnapTracking();
  statusChip.textContent = "Облако создано";
  draw();
}

function placeRevisionCloudPoint(point) {
  if (!isLinePoint(point)) return;
  const draft = state.drawing;
  if (!draft) {
    state.drawing = { points: [point], arcLength: screenUiPx(24) / state.view.scale };
  } else if (state.revisionCloudMode === "rectangle") {
    commitRevisionCloud(point);
    return;
  } else if (draft.points.length >= 3 && distanceWorld(draft.points[0], point) * state.view.scale <= screenUiPx(12)) {
    commitRevisionCloud();
    return;
  } else if (draft.points.length >= MAX_REVISION_CLOUD_CORNERS) {
    statusChip.textContent = "Замкните контур облака";
    return;
  } else if (distanceWorld(draft.points.at(-1), point) > linePointEpsilon) {
    draft.points.push(point);
  }
  statusChip.textContent = revisionCloudPrompt();
  draw();
}

function traceMatchesEditingContext(entity) {
  return (entity.layer === TRACE_LAYER) === state.traceEditing;
}

function traceIsReference(entity) {
  return entity.layer !== TRACE_LAYER || state.traceEditing;
}

function resetTrace() {
  state.traceOptions = false;
  state.traceEditing = false;
  state.traceHistory = { undo: [], redo: [] };
  shell.removeAttribute("data-trace-editing");
}

function setTraceEditing(editing) {
  if (state.traceEditing === editing) return;
  const { undo, redo } = state.traceHistory;
  state.traceHistory = { undo: state.undo, redo: state.redo };
  state.undo = undo;
  state.redo = redo;
  state.traceEditing = editing;
  shell.toggleAttribute("data-trace-editing", editing);
  setSelection(null);
  if (editing && !state.visibleLayers.has(TRACE_LAYER)) {
    state.visibleLayers.add(TRACE_LAYER);
    markProjectDirty("trace-visibility");
  }
}

function syncTraceControls() {
  traceControls.hidden = !state.traceOptions || !annotationToolMenu.hidden || !selectModeMenu.hidden ||
    !drawToolMenu.hidden || !dimensionToolMenu.hidden || !copyToolMenu.hidden || snapMore.open;
  if (traceControls.hidden) return;
  const visible = state.visibleLayers.has(TRACE_LAYER);
  traceVisibilityButton.setAttribute("aria-pressed", String(visible));
  traceVisibilityButton.textContent = visible ? "Скрыть кальку" : "Показать кальку";
  traceEditButton.setAttribute("aria-pressed", String(state.traceEditing));
  traceEditButton.textContent = state.traceEditing ? "Завершить правку" : "Править кальку";
}

function dimensionToolStatusText() {
  if (state.dimensionTool === "leader") return leaderPlacementHint();
  const text = {
    aligned: "Размер по отрезку. 1 из 3: укажите начало",
    linear: "Размер по оси. 1 из 3: укажите первую точку",
    angular: state.angleMode === "select" ? "Угол · выберите первую сторону" : "Угол · укажите вершину",
    chain: "Множественный размер · укажите первую точку",
    radial: "Размер круга · выберите круг или дугу",
    "arc-length": "Длина дуги · выберите дугу",
    ordinate: "Координатный размер · укажите точку",
    "jogged-radius": "Радиус с изломом · выберите дугу или окружность",
    rotated: "Размер под углом · укажите первую точку",
  };
  return text[state.dimensionTool] || text.aligned;
}

function selectSelectionTool(tool) {
  state.selectTool = tool;
  hideSelectModeMenu();
  setTool("select");
  canvas.focus({ preventScroll: true });
  syncSelectionActions();
}

function selectionStatusText() {
  return { window: "Рамка · тяните по холсту", lasso: "Лассо · обведите область", multi: "Выбор нескольких объектов" }[state.selectTool] || "Выберите объект";
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
  if (state.traceEditing) entity.layer = TRACE_LAYER;
  if (isLayerLocked(entity.layer)) {
    statusChip.textContent = layerLockMessage(entity.layer || DEFAULT_LINE_LAYER);
    return false;
  }
  state.entities.push(entity);
  state.undo.push({ type: "add", entity });
  state.redo.length = 0;
  state.selectedId = select ? entity.id : null;
  state.selectedIds = select ? [entity.id] : [];
  markProjectDirty("add");
  return true;
}

function createEntityFromDrawing() {
  const { start, end } = state.drawing;
  const id = newLineId(state.tool);
  if (state.tool === "circle") return circleEntity(id, start.x, start.y, distanceWorld(start, end));
  if (state.tool === "rectangle") return rectangleEntity(id, start.x, start.y, end.x, end.y);
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
  if (state.dimensionTool === "chain") {
    const side = (Math.abs(axis.x) > 1e-8 ? axis.x : -axis.y) >= 0 ? -1 : 1;
    return side * Math.min(annotationWorldSize(24, state.annotationScale), 24 / state.view.scale, measurement * 0.35);
  }
  const axisTip = { x: start.x + axis.x * measurement, y: start.y + axis.y * measurement };
  const offset = dimensionOffsetWithAlignmentSnap(start, axisTip, point);
  return Math.abs(offset) < 60 ? (offset < 0 ? -260 : 260) : offset;
}

function commitDimensionSegment(geometry, placement) {
  const draft = state.drawing;
  draft.offset = draftDimensionOffset(geometry, placement);
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
    statusChip.textContent = "Цепочка · следующая точка или «Готово»";
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
  const choosingDirection = !surveyPointPicker && draft && state.numericEdit?.lineMetric?.lockedAngle === undefined &&
    (lineMetricKinds.get(input) === "length" || draft.metricConstraint?.length !== undefined);
  polylineArcMode.hidden = !drawing || Boolean(surveyPointPicker) || Boolean(input);
  polylineArcMode.setAttribute("aria-pressed", String(Boolean(drawing?.arcPhase)));
  linePointAssist.hidden = !choosingDirection && polylineArcMode.hidden;
  cornerMetrics.hidden = inlineEditors.hidden && drawMetrics.hidden && linePointAssist.hidden;
  lineDirection.hidden = !choosingDirection;
  if (choosingDirection && lineDirection.value !== (draft.metricDirection || "")) lineDirection.value = draft.metricDirection || "";
  document.getElementById("undoButton").disabled = !state.undo.length && size < 2 && !drawing?.arcEnd &&
    !state.planZone?.points.length && !state.drawing?.circlePicks?.length;
  document.getElementById("redoButton").disabled = !state.redo.length || Boolean(state.drawing || edit);
  lineUi.lineEditOptions.hidden = !edit;
  lineUi.lineEditForm.hidden = !lineQuantityModes[edit?.mode];
  lineUi.lineEditRadiusControl.hidden = edit?.mode !== "fillet";
  const mirroring = edit?.mode === "mirror";
  lineUi.lineMirrorModes.hidden = lineUi.lineMirrorControl.hidden = !mirroring;
  lineUi.lineMirrorModes.querySelector('[data-mirror-axis="line"]').setAttribute("aria-pressed", String(Boolean(mirroring && edit.pickMirrorAxis)));
  const canChooseAction = viewportIsSelecting();
  quickMirrorTool.disabled = !mirroring && !canChooseAction;
  quickMirrorTool.setAttribute("aria-expanded", String(mirroring));
  quickMirrorTool.setAttribute("aria-pressed", String(state.actionPicking === "mirror"));
  const repeatableCut = boundaryEditModes.has(edit?.mode);
  quickMoveTool.disabled = !canChooseAction && state.moveCommand?.mode !== "move";
  quickScaleTool.disabled = !canChooseAction;
  quickMoveTool.setAttribute("aria-pressed", String(state.actionPicking === "move" || state.moveCommand?.mode === "move"));
  quickScaleTool.setAttribute("aria-pressed", String(state.actionPicking === "scale-selection"));
  const copying = state.moveCommand?.mode === "copy";
  if ((!viewportIsSelecting() && !copying && !state.copyPicking) || !selectModeMenu.hidden || !drawToolMenu.hidden || !dimensionToolMenu.hidden || !annotationToolMenu.hidden) copyToolMenu.hidden = true;
  quickCopyTool.disabled = !copying && !viewportIsSelecting();
  quickCopyTool.setAttribute("aria-expanded", String(!copyToolMenu.hidden || Boolean(state.copyPicking) || copying));
  const arrayCopying = copying && state.moveCommand.copyMode === "array";
  copyControls.hidden = !state.copyPicking && !arrayCopying && !state.actionPicking;
  copyCountControl.hidden = !arrayCopying;
  selectionActionLabel.hidden = !state.actionPicking;
  selectionActionLabel.textContent = state.actionPicking ? selectionActionLabels[state.actionPicking] : "";
  const selectionControlsLabel = state.actionPicking ? `${selectionActionLabels[state.actionPicking]}: выбор объектов` : "Копирование";
  copyControls.setAttribute("aria-label", selectionControlsLabel);
  copyConfirm.hidden = !state.copyPicking && !state.actionPicking;
  copyConfirm.disabled = Boolean(state.copyPicking && !selectedEntities().length) || Boolean(state.actionPicking && !canApplySelectionAction(state.actionPicking));
  copyConfirm.setAttribute("aria-label", "Подтвердить выбор");
  copyConfirm.title = copyConfirm.getAttribute("aria-label");
  copyClose.hidden = false;
  const closeLabel = state.actionPicking ? "Отменить выбор для операции" : "Закрыть копирование";
  copyClose.setAttribute("aria-label", closeLabel);
  copyClose.title = closeLabel;
  quickRotateTool.disabled = !canChooseAction && state.moveCommand?.mode !== "rotate";
  quickDeleteTool.disabled = !canChooseAction;
  quickRotateTool.setAttribute("aria-pressed", String(state.actionPicking === "rotate" || state.moveCommand?.mode === "rotate"));
  quickDeleteTool.setAttribute("aria-pressed", String(state.actionPicking === "delete"));
  for (const button of quickEditButtons) {
    const mode = button.dataset.quickEdit;
    const active = mode === edit?.mode;
    button.disabled = !active && !canChooseAction;
    button.setAttribute("aria-pressed", String(active));
  }
  lineUi.lineEditSelective.hidden = !repeatableCut;
  lineUi.lineEditSelective.setAttribute("aria-pressed", String(Boolean(repeatableCut && !edit.quick)));
  const selectiveLabel = edit?.quick ? "Выборочная правка с подтверждением" : "Вернуться к быстрой правке касанием";
  lineUi.lineEditSelective.title = selectiveLabel;
  lineUi.lineEditSelective.setAttribute("aria-label", selectiveLabel);
  lineUi.lineBreakControl.hidden = edit?.mode !== "break";
  if (edit?.mode === "break") for (const button of breakModeButtons) {
    button.setAttribute("aria-pressed", String(button.dataset.breakMode === edit.breakMode));
  }
  const finishing = edit?.applied && !edit.pending && repeatableCut;
  lineUi.lineEditCancel.hidden = Boolean(finishing);
  lineUi.lineEditFinish.hidden = !finishing;
  lineUi.lineEditApply.hidden = !edit?.pending;
  lineUi.lineEditApply.disabled = false;
  const label = edit?.mode === "offset" ? "Создать отступ" : "Подтвердить правку";
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
  const layer = draft?.layer ?? revealActiveLineLayer();
  if (!layer || isLayerLocked(layer)) {
    statusChip.textContent = layerLockMessage(layer);
    return false;
  }
  if (!draft) {
    setSelection(null);
    state.drawing = { points: [point], start: point, end: point, lockedEnd: false, layer };
    if (polyline) {
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
      pushEntity(line(newLineId(), start.x, start.y, point.x, point.y, layer), { select: false });
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
  const result = draftArcFromBend(draft.start, end, point);
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
    if (!pushEntity(entity, { select: false })) return false;
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
  return state.entities.find((entity) => entity.id === id && isLayerVisible(entity.layer) && !isLayerLocked(entity.layer) && traceMatchesEditingContext(entity) &&
    (mode === "mirror" ? editableFigure(entity, mode) || ["wall", "block"].includes(entity.type)
      : figureCutActions.has(mode) ? editableFigure(entity, mode) : isDraftLine(entity) || (mode === "scale" && isReusableBlock(entity))));
}

function lineEditSources(edit = state.lineEdit) {
  if (!edit) return [];
  const ids = edit.sourceIds?.length ? edit.sourceIds : edit.sourceId ? [edit.sourceId] : [];
  return ids.map((id) => lineEditEntity(id, edit.mode)).filter(Boolean);
}

function pickDraftLine(screen, includeFigures = false, candidates = null, mode, readOnly = false) {
  let best = null;
  let distance = 18;
  for (const entity of candidates ?? state.entities) {
    if (!(includeFigures ? editableFigure(entity, mode) : isDraftLine(entity)) || !isLayerVisible(entity.layer) || !traceIsReference(entity) ||
        (!readOnly && (isLayerLocked(entity.layer) || !traceMatchesEditingContext(entity)))) continue;
    const next = distanceToEntityScreen(screen, entity);
    if (next <= distance) {
      best = entity;
      distance = next;
    }
  }
  return best;
}

function startQuickEdit(mode, { selective = false } = {}) {
  if (surveyPointPicker || (state.tool === "polyline" && state.drawing && !finishLineCommand())) return;
  const selected = state.tool === "select" ? selectedEntities().filter(entity => isLayerVisible(entity.layer)) : [];
  const selection = selected.map(entity => entity.id);
  const source = selective && boundaryEditModes.has(mode) && selected.length === 1 && editableFigure(selected[0], mode) ? selected[0] : null;
  hideDrawToolMenu();
  hideDimensionToolMenu();
  hideAnnotationToolMenu();
  hideSelectModeMenu();
  setTool("select");
  setSelection(selection);
  startLineEdit(mode, source, { quick: boundaryEditModes.has(mode) ? !selective : true });
  if (selective && boundaryEditModes.has(mode)) {
    const label = mode === "trim" ? "Обрезка" : "Удлинение";
    setLineEditHint(`${label} выборочно · коснитесь объекта и подтвердите ✓`);
  }
  canvas.focus({ preventScroll: true });
}

function startLineEdit(mode, entity, { quick = false, filletIds = [], sourceIds = [] } = {}) {
  hideSelectModeMenu();
  state.lineEdit = {
    mode, quick, sourceId: entity?.id, sourceIds: sourceIds.length ? [...new Set(sourceIds)] : entity?.id ? [entity.id] : [],
    joinIds: [], filletIds, firstPick: null, amount: null,
    breakMode: "gap", pending: null, applied: false,
  };
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
      const labels = { distance: "Отступ", through: "Через точку", factor: "Коэф." };
      labelContextIcon(button, labels[value]);
      return button;
    }));
    syncLineQuantityFields();
  }
  lineUi.lineMirrorDelete.checked = false;
  if (mode === "fillet") {
    const unit = projectUnit(state.measurementSettings).label;
    lineUi.lineEditRadiusControl.querySelector(".metric-unit").textContent = unit;
    lineUi.lineEditRadius.setAttribute("aria-label", `Радиус скругления, ${unit}`);
  }
  const prompts = {
    ...boundaryEditPrompts,
    break: "Наведите крестик на первую точку разрыва",
    join: "Соединить: выберите линии на той же прямой",
    fillet: "Скругление: коснитесь второй линии",
    offset: "Смещение: введите расстояние или выберите «Через точку»",
    mirror: "Выберите ось отражения",
    scale: "Масштаб: введите коэффициент и укажите базовую точку",
  };
  setLineEditHint(prompts[mode]);
  if (filletIds.length > 1) refreshFilletPreview(state.lineEdit);
  draw();
}

function endLineEdit(text) {
  state.lineEdit = null;
  setLineEditHint(text);
  draw();
}


function boundarySegments(excludedId) {
  const segments = [];
  for (const { p1, p2, entity, arc } of drawableSnapSegments()) {
    if (entity.id === excludedId) continue;
    if (arc) {
      segments.push(arc);
      continue;
    }
    const segment = { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
    if (entity.type === "wall" && Number.isFinite(entity.width) && entity.width > 0) {
      const { a, b } = offsetWall(entity, entity.width / 2);
      segments.push(a, b, { x1: a.x1, y1: a.y1, x2: b.x1, y2: b.y1 },
        { x1: a.x2, y1: a.y2, x2: b.x2, y2: b.y2 });
    } else {
      segments.push(segment);
    }
  }
  return segments.concat(state.entities.filter((entity) => entity.id !== excludedId &&
    isLayerVisible(entity.layer) && traceIsReference(entity) &&
    ["circle", "arc"].includes(entity.type)));
}

function syncLineQuantityFields() {
  const mode = state.lineEdit.lengthMode;
  const form = lineUi.lineEditForm;
  const input = lineUi.lineLengthInput;
  const pointOnly = mode === "through";
  const scale = mode === "factor";
  form.dataset.fields = pointOnly ? "mode" : scale ? "value" : "";
  lineUi.lineLengthModes.hidden = scale;
  for (const button of lineUi.lineLengthModes.children) button.setAttribute("aria-pressed", String(button.dataset.lengthMode === mode));
  input.parentElement.hidden = pointOnly;
  form.querySelector("button[type=submit]").hidden = pointOnly || state.lineEdit.mode === "offset";
  input.placeholder = scale ? "1,5" : projectUnit(state.measurementSettings).label;
  input.setAttribute("aria-label", scale ? "Коэффициент масштаба" : "Расстояние смещения");
}

function submitLineLength() {
  const edit = state.lineEdit;
  if (!lineQuantityModes[edit?.mode] || edit.lengthMode === "through") return;
  const input = lineUi.lineLengthInput;
  const mode = edit.lengthMode;
  const value = input.value.trim();
  const number = parseLineDecimal(value);
  const amount = mode === "factor" ? number : fromProjectLength(number, state.measurementSettings);
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_LINE_COORDINATE) {
    input.setAttribute("aria-invalid", "true");
    setLineEditHint("Введите допустимое числовое значение");
    return;
  }
  edit.amount = amount;
  input.removeAttribute("aria-invalid");
  if (edit.mode === "offset") {
    refreshOffsetPreviewFromCursor(edit);
    setLineEditHint("Перемещайте чертёж: отступ строится со стороны крестика · нажмите ✓");
  } else {
    setLineEditHint("Наведите крестик на базу масштабирования");
  }
  input.blur();
  draw();
}

function updateOffsetAmountFromInput(edit = state.lineEdit) {
  if (edit?.mode !== "offset" || edit.lengthMode !== "distance") return false;
  const number = parseLineDecimal(lineUi.lineLengthInput.value.trim());
  const amount = fromProjectLength(number, state.measurementSettings);
  edit.amount = Number.isFinite(amount) && amount > 0 && amount <= MAX_LINE_COORDINATE ? amount : null;
  lineUi.lineLengthInput.toggleAttribute("aria-invalid", lineUi.lineLengthInput.value.trim() !== "" && edit.amount === null);
  return edit.amount !== null;
}

function refreshOffsetPreviewFromCursor(edit = state.lineEdit) {
  if (edit?.mode !== "offset") return false;
  const source = lineEditEntity(edit.sourceId, edit.mode);
  const through = edit.lengthMode === "through";
  if (!source || (!through && edit.amount === null)) {
    edit.pending = null;
    return false;
  }
  const point = rawCursorWorld();
  const coordinates = parallelLine(source, point, through ? null : edit.amount);
  if (!coordinates) {
    edit.pending = null;
    return false;
  }
  const preview = { ...source, ...coordinates, id: edit.offsetPreviewId ||= newLineId(source.type || "line") };
  if (!validFigurePiece(preview)) {
    edit.pending = null;
    return false;
  }
  edit.pending = { replacements: [], message: "Смещение создано", added: [preview], association: "follow" };
  return true;
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
  return Boolean(edit && (["break", "offset", "scale"].includes(edit.mode) || (edit.mode === "mirror" && edit.pickMirrorAxis)));
}

function resolveLineEditPoint(edit, raw) {
  if (edit.mode === "mirror" && edit.pickMirrorAxis && edit.mirrorStart) {
    return resolveLineLikeSnap(raw, edit.mirrorStart);
  }
  return resolveSnapWorld(raw, { polarStart: null });
}

function refreshFilletPreview(edit) {
  const ids = edit.filletSecond ? [...edit.filletIds, edit.filletSecond.id] : edit.filletIds;
  if (ids.length < 2) return;
  edit.pending = null;
  const radius = fromProjectLength(lineUi.lineEditRadius.valueAsNumber, state.measurementSettings);
  const lines = ids.map((id) => lineEditEntity(id));
  if (!Number.isFinite(radius) || radius < 0) {
    setLineEditHint("Введите радиус скругления");
  } else if (lines.every(Boolean)) {
    const [first, second] = lines;
    const pair = lines.length === 2 ? filletSelectedPair(first, second, radius, edit.filletSecond?.pick) : null;
    const result = lines.length > 2 ? filletSelectedCorners(lines, radius) : pair && {
      changes: new Map([[first, pair.first], [second, pair.second]]),
      arcs: pair.arc ? [{ ...pair.arc, layer: first.layer }] : [],
    };
    if (result?.changes.size) {
      const replacements = [...result.changes].map(([line, geometry]) => [line, [geometry]]);
      const arcs = result.arcs.map(({ start, through, end, layer }) => arcEntity(newLineId("arc"), start, through, end, layer));
      previewLineEdit(replacements, arcs.length ? `Скруглено углов: ${arcs.length}` : "Углы соединены", arcs, "preserve");
    } else {
      setLineEditHint(result ? "Выберите отрезки с общими углами" : "Скругление невозможно. Проверьте радиус и расположение линий");
    }
  } else {
    setLineEditHint("Линия недоступна");
  }
  draw();
}

function pickLineEditPoint(screen) {
  const edit = state.lineEdit;
  if (!edit) return;
  if (edit.quick) return applyQuickEdit(edit.mode, screen);
  if (edit.mode === "fillet") {
    if (edit.filletIds.length > 1) return;
    const hit = pickDraftLine(screen, false, state.entities.filter(({ id }) => id !== edit.sourceId));
    if (!hit) {
      if (!edit.pending) setLineEditHint("Скругление: коснитесь второй линии");
      return;
    }
    edit.filletSecond = { id: hit.id, pick: screenToWorld(screen) };
    refreshFilletPreview(edit);
    return;
  }
  const source = lineEditEntity(edit.sourceId, edit.mode);
  const repeat = boundaryEditModes.has(edit.mode);
  if (edit.pending) {
    edit.pending = null;
    draw();
  }
  if (!source && !repeat) return endLineEdit("Линия недоступна");
  const point = lineEditPlacesPoint(edit) ? cursorWorld() : screenToWorld(screen);
  if (edit.mode === "mirror") {
    if (!edit.pickMirrorAxis) return;
    if (!edit.mirrorStart) {
      edit.mirrorStart = point;
      resetSnapTracking();
      setLineEditHint("Ось отражения: укажите вторую точку");
      draw();
      return;
    }
    if (distanceWorld(edit.mirrorStart, point) <= linePointEpsilon) {
      return setLineEditHint("Ось отражения: укажите другую вторую точку");
    }
    previewMirror(source, edit.mirrorStart, point);
    return;
  }
  if (["offset", "scale"].includes(edit.mode)) {
    placeLineTransform(edit, source, point);
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
  if (!edit.applied && source && hit !== source) return setLineEditHint("Коснитесь выбранного объекта");
  setSelection(hit.id);
  const result = cutFigureAt(hit, edit.mode, point);
  if (result.error) return setLineEditHint(result.error);
  previewLineEdit([[hit, result.pieces]], result.message, [], result.association);
}

function cutFigureAt(entity, mode, point) {
  if (!entity) return { error: "Коснитесь объекта на чертеже" };
  if (!editableFigure(entity, mode)) return { error: "У замкнутого контура нет конца для удлинения" };
  const boundaries = boundarySegments(entity.id);
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
  if (replaced && edit?.quick) {
    state.lineEdit = edit;
    setSelection(selected.flatMap(item => item.id === entity.id ? replaced : [item.id]));
    draw();
  }
}

function placeLineTransform(edit, source, point) {
  if (edit.mode === "offset") {
    refreshOffsetPreviewFromCursor(edit);
    return;
  }
  if (edit.mode === "scale") {
    if (edit.amount === null) return setLineEditHint("Укажите коэффициент и нажмите галочку");
    if (isReusableBlock(source)) {
      const geometry = { type: "block", x: point.x + (source.x - point.x) * edit.amount,
        y: point.y + (source.y - point.y) * edit.amount, scale: (source.scale ?? 1) * edit.amount };
      if (!expandReusableBlock({ ...source, ...geometry })) return setLineEditHint("Масштабирование невозможно с этим коэффициентом");
      previewLineEdit([[source, [geometry]]], "Масштаб блока изменён");
      return;
    }
    const coordinates = scaleLine(source, point, edit.amount);
    if (!coordinates) return setLineEditHint("Масштабирование невозможно с этим коэффициентом");
    previewLineEdit([[source, [coordinates]]], "Масштаб линии изменён");
    return;
  }
}

function mirroredFigureGeometry(source, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const axis = normalizeWorldVector(dx, dy);
  if (!axis) return { error: "Выберите линию ненулевой длины" };
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
    if (isReusableBlock(source) && !expandReusableBlock({ ...source, ...geometry })) {
      return { error: "Координаты блока после отражения вне диапазона" };
    }
  } else {
    geometry = mirrorLine(source, start, end);
  }
  return geometry ? { geometry } : { error: "Отражение невозможно" };
}

function previewMirror(source, start, end) {
  const edit = state.lineEdit;
  edit.mirrorAxis = { start, end };
  const sources = lineEditSources(edit);
  if (!sources.length && source) sources.push(source);
  if (!sources.length || sources.length !== edit.sourceIds.length) return setLineEditHint("Объекты недоступны");
  const mirrored = sources.map((entity) => ({ entity, ...mirroredFigureGeometry(entity, start, end) }));
  const failed = mirrored.find(({ error }) => error);
  if (failed) return setLineEditHint(failed.error);
  const count = mirrored.length;
  if (lineUi.lineMirrorDelete.checked) {
    previewLineEdit(mirrored.map(({ entity, geometry }) => [entity, [geometry]]),
      count > 1 ? `Отражено объектов: ${count}` : "Объект отражён");
  } else {
    const copiedGroups = new Map();
    const added = mirrored.map(({ entity, geometry }) => {
      const copy = replaceFigureGeometry(entity, geometry, newLineId(geometry.type || entity.type));
      if (entity.groupId) {
        if (!copiedGroups.has(entity.groupId)) copiedGroups.set(entity.groupId, newLineId("group"));
        copy.groupId = copiedGroups.get(entity.groupId);
      }
      return copy;
    });
    previewLineEdit([], count > 1 ? `Создано отражённых копий: ${count}` : "Отражённая копия создана", added);
  }
}


function previewLineEdit(replacements, message, added = [], association = "follow") {
  const edit = state.lineEdit;
  if (!edit) return;
  edit.pending = null;
  const changes = replacements.filter(([entity, pieces]) => pieces.length !== 1 || geometryChanged(entity, pieces[0]));
  if (!changes.length && !added.length) {
    setLineEditHint(edit.mode === "fillet" ? "Укажите радиус скругления больше нуля" : "Геометрия уже соответствует заданию");
    draw();
    return;
  }
  const valid = piece => ["mirror", "scale"].includes(edit.mode) && piece.type === "block" ? isLinePoint(piece)
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
  if (!edit.pending) return;
  const { replacements, message, added, association } = edit.pending;
  if (!commitLineEdit(replacements, message, added, association)) return;
  if (["trim", "extend"].includes(edit.mode)) {
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
  const changed = [...replacements.flatMap(([entity, pieces]) => [entity, ...pieces.map((piece) => ({ layer: piece.layer ?? entity.layer }))]), ...added];
  const locked = changed.find((entity) => isLayerLocked(entity.layer));
  if (locked) {
    endLineEdit(layerLockMessage(locked.layer || DEFAULT_LINE_LAYER));
    return null;
  }
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
  if (entity.layer !== "dimensions" || isLayerLocked(entity.layer)) return entity;
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
      const point = figureMetricPreview(grip) ?? cursorWorld();
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
  if (edit?.mode === "mirror" && edit.pickMirrorAxis && edit.mirrorStart) {
    const end = edit.mirrorAxis?.end || cursorWorld();
    if (distanceWorld(edit.mirrorStart, end) > linePointEpsilon) {
      drawEditableSegment(edit.mirrorStart, end, c, { dashed: true, showHandles: true });
    } else {
      const start = worldToScreen(edit.mirrorStart);
      drawEndpointHandle(start, true, c);
    }
  }
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
  const point = projectFigurePoint(source, cursorWorld());
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
  const corner = entity.type === "rectangle" && pointer.grip.key === "corner"
    ? rectangleCorners(entity)[(pointer.grip.index + 2) % 4] : null;
  const point = pointer.grip.key === "text-width" ? raw
    : corner ? resolveLineLikeSnap(raw, corner, { useOrtho: false }).point : resolveSnapWorld(raw).point;
  pointer.preview = reshapeFigure(entity, pointer.grip, point);
  if (!pointer.preview) statusChip.textContent = "Выберите другую точку для фигуры";
  else if (entity.type === "circle") statusChip.textContent = `Радиус ${projectLength(pointer.preview.radius)}`;
  else if (entity.type === "text") statusChip.textContent = `Ширина текстового блока ${projectLength(pointer.preview.textWidth)}`;
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
  if (!entity || isLayerLocked(entity.layer) || !pointer.moved || !pointer.preview) return;
  const after = { ...pointer.before, ...pointer.preview };
  if (!geometryChanged(pointer.before, after)) return;
  applyEntityGeometry(entity, after);
  state.undo.push({ type: "move", entityId: entity.id, before: pointer.before, after });
  state.redo.length = 0;
  statusChip.textContent = pointer.grip === "radius" ? "Размерная дуга перемещена" : "Угловой размер изменён";
}

function finishFigureGrip(pointer) {
  const entity = state.entities.find(item => item.id === pointer.grip.entityId);
  if (!entity || isLayerLocked(entity.layer)) return;
  if (!pointer.moved) {
    state.selectedFigureGrip = pointer.grip;
    hideSelectToolMenu();
    if (!spenCursorActive()) centerViewOnWorldPoint(pointer.grip.point);
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
    statusChip.textContent = entity.type === "circle" ? "Радиус круга обновлён" :
      entity.type === "text" ? "Ширина текстового блока обновлена" : "Фигура обновлена";
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
  if (!entity || isLayerLocked(entity.layer)) return;
  if (!pointer.moved) {
    if (pointer.grip.point === "middle") {
      const base = midpoint({ x: entity.x1, y: entity.y1 }, { x: entity.x2, y: entity.y2 });
      startMoveLikeCommand(entity, "move");
      if (!spenCursorActive()) centerViewOnWorldPoint(base);
      commitMoveCommandPoint(base);
    } else {
      selectLineEndpoint(pointer.grip);
    }
    return;
  }
  const before = entityGeometry(entity);
  if (pointer.preview && isValidLine(pointer.preview) && geometryChanged(before, pointer.preview)) {
    const after = pointer.preview;
    const side = pointer.grip.point;
    applyEntityGeometry(entity, after);
    state.undo.push({ type: "move", entityId: entity.id, before, after });
    state.redo.length = 0;
    statusChip.textContent = side === "middle" ? "Линия перемещена" : "Конец линии обновлён";
  }
  pointer.preview = null;
  resetSnapTracking();
  draw();
}

function selectLineEndpoint(endpoint) {
  const entity = state.entities.find((item) => item.id === endpoint?.entityId);
  if (!entity || entity.type === "block" || isLayerLocked(entity.layer)) return false;
  state.selectedId = entity.id;
  if (!state.selectedIds.includes(entity.id)) state.selectedIds = [entity.id];
  state.selectedEndpoint = { entityId: entity.id, point: endpoint.point };
  state.endpointEditBefore = entityGeometry(entity);
  state.drawing = null;
  const geometry = selectedEndpointGeometry();
  if (geometry && !spenCursorActive()) centerViewOnWorldPoint(geometry.moving);
  resetSnapTracking();
  updateSelectedEndpointEditors(geometry ? endpointCursorPoint(geometry) : null);
  statusChip.textContent = spenCursorActive() ? "Конец линии выбран. Укажите пером новую точку" : "Конец линии выбран. Подведите центр к новой точке и тапните";
  draw();
  return true;
}

function commitCursorPoint(screen = inputCursorScreen(), exactPoint = null) {
  if (state.leaderInput) return;
  if (state.quickMeasure) {
    commitQuickMeasurePoint();
    return;
  }
  if (surveyPointPicker) {
    commitSurveyPoint();
    return;
  }
  const targetLayer = annotationLayerForTool(state.tool) || (["circle", "rectangle", "arc"].includes(state.tool) ? DEFAULT_LINE_LAYER : null);
  if (targetLayer && isLayerLocked(targetLayer)) {
    statusChip.textContent = layerLockMessage(targetLayer);
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
  const world = exactPoint ?? resolved.point;
  if (state.tool === "revision-cloud") {
    placeRevisionCloudPoint(world);
    return;
  }
  if (state.blockPlacement) {
    placeReusableBlock(world);
    return;
  }
  if (state.selectedFigureGrip) {
    commitFigureGripPoint(world);
    return;
  }
  if (state.selectedEndpoint) {
    commitSelectedEndpointCursorPoint();
    return;
  }
  if (state.offsetCommand) {
    commitOffsetCommandPoint(world);
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
    if (additionalDimensionKinds.includes(state.dimensionTool)) {
      commitAdditionalDimension(world, screen);
      return;
    }
    if (state.dimensionTool === "radial") {
      commitRadialDimension(screen);
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
      statusChip.textContent = state.dimensionTool === "chain" ? "Цепочка · укажите вторую точку" : "Размер: начало поставлено. Поставьте вторую точку";
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
      if (state.dimensionTool === "chain") {
        commitDimensionSegment(geometry, end);
      } else {
        state.drawing.lockedEnd = true;
        state.drawing.phase = "offset";
        statusChip.textContent = `Размер ${projectLength(geometry.measurement)}. Укажите положение размерной линии`;
      }
    } else if (state.drawing.phase === "offset") {
      const { start, end } = state.drawing;
      const geometry = dimensionGeometry(draftDimension(start, end));
      if (!geometry) return;
      commitDimensionSegment(geometry, world);
    }
    draw();
    return;
  }
  if (state.tool === "line" || state.tool === "polyline") {
    commitLinePoint(state.drawing?.lockedEnd ? state.drawing.end : world);
    return;
  }
  if (state.tool === "circle" && state.circleMode !== "center") {
    commitCircleConstruction(screen, world);
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
      if (finishedTool === "arc" && !state.drawing.arcEnd) {
        if (distanceWorld(state.drawing.start, end) <= linePointEpsilon) {
          statusChip.textContent = "Укажите другой конец дуги";
          return;
        }
        state.drawing.arcEnd = end;
        state.drawing.end = end;
        state.drawing.lockedEnd = false;
        resetSnapTracking();
        statusChip.textContent = "Дуга: укажите изгиб";
        draw();
        return;
      }
      state.drawing.end = end;
      const metrics = segmentMetrics(state.drawing.start.x, state.drawing.start.y, end.x, end.y);
      const arc = finishedTool === "arc" ? draftArcFromBend(state.drawing.start, state.drawing.arcEnd, end)?.arc : null;
      const validShape = finishedTool === "arc" ? Boolean(arc) : metrics.length > 0 &&
        (finishedTool !== "rectangle" || (end.x !== state.drawing.start.x && end.y !== state.drawing.start.y));
      if (finishedTool === "arc" && !validShape) {
        statusChip.textContent = "Дуга: отведите крестик дальше от хорды";
        draw();
        return;
      }
      if (!validShape) { statusChip.textContent = `${drawingToolName(finishedTool)}: нужна другая точка`; draw(); return; }
      pushEntity(arc ? arcEntity(newLineId("arc"), arc.start, arc.through, arc.end) : createEntityFromDrawing());
      hideDrawToolMenu();
      state.selectTool = "select";
      setTool("select");
      statusChip.textContent = drawingFinishedStatus(finishedTool);
    }
  } else {
    setSelection(pickEntity(screen) || state.selectedId);
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
  if (!command || !entity || isLayerLocked(entity.layer)) return;
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
  if (!entity || isLayerLocked(entity.layer)) {
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
    const entities = state.entities.filter(item => command.entityIds.has(item.id) && isLayerVisible(item.layer) && !isLayerLocked(item.layer));
    const edits = Math.abs(delta) <= 1e-12 ? [] : entities.flatMap((item) => {
      const before = cloneProjectEntity(item);
      const after = rotatedEntitySnapshot(item, command.base, delta);
      return before && after ? [{ entityId: item.id, before, after }] : [];
    });
    if (entities.length !== command.entityIds.size || (Math.abs(delta) > 1e-12 && edits.length !== entities.length)) {
      statusChip.textContent = "Координаты после поворота вне диапазона";
      draw();
      return;
    }
    state.moveCommand = null;
    resetSnapTracking();
    syncCommandState();
    hideInlineEditors();
    if (!edits.length) {
      statusChip.textContent = "Угол не изменён";
      draw();
      return;
    }
    commitEntityBatch(edits, [...command.entityIds], "rotate-selection");
    statusChip.textContent = edits.length > 1 ? `Повернуто объектов: ${edits.length}` : "Поворот применён";
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
  const entities = state.entities.filter(entity => command.entityIds.has(entity.id) && isLayerVisible(entity.layer) && !isLayerLocked(entity.layer));
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
    const layer = revealActiveLineLayer();
    if (!layer) {
      statusChip.textContent = layerLockMessage(layer);
      return;
    }
    pushEntity(line(newLineId(), base.x, base.y, end.x, end.y, layer));
  }
  draw();
}

function selectedEndPoint() {
  const selected = state.entities.find((entity) => entity.id === state.selectedId);
  if (!selected || selected.type === "block") return { x: 0, y: 0 };
  return { x: selected.x2, y: selected.y2 };
}

function beginSpenLengthInput() {
  const draft = state.drawing;
  if (!draft || state.leaderInput || surveyPointPicker || state.quickMeasure) return false;
  const lineDraft = ["line", "polyline"].includes(state.tool) && !draft.arcPhase;
  const end = lineMetricPreview(draft.start) ?? figureMetricPreview(draft) ?? (draft.lockedEnd ? draft.end : cursorWorld());
  const figure = draftFigureReference(end);
  if (!lineDraft && !figure) return false;
  const input = lineDraft || figure.type === "circle" ? lengthInput : topLengthInput;
  const current = state.numericEdit?.lineMetric || state.numericEdit?.figureMetric;
  if (current?.lockedBySpen && current.key === (lineDraft ? draft.start : draft)) {
    input.focus({ preventScroll: true });
    window.ZamerAndroid?.showKeyboard?.();
    return true;
  }
  const arc = figure?.arcEnd && draftArcFromBend(draft.start, figure.arcEnd, end)?.arc;
  const length = lineDraft ? distanceWorld(draft.start, end) : figureMetrics(figure, arc).values[0];
  if (!isLinePoint(end) || !(length > linePointEpsilon)) {
    statusChip.textContent = "Сначала укажите направление пером";
    return true;
  }
  // Capture the resolved point before focus/IME changes the viewport or the
  // hover stream. The numeric preview must no longer follow the pen.
  draft.end = { ...end };
  drawNow();
  beginNumericInputEdit(input);
  const edit = state.numericEdit?.lineMetric || state.numericEdit?.figureMetric;
  if (!edit) return true;
  edit.end = { ...end };
  edit.point = { ...end };
  edit.lockedBySpen = true;
  if (lineDraft) {
    edit.length = length;
    edit.lockedAngle = -radToDeg(angleBetweenPoints(draft.start, end));
  } else edit.values.length = length;
  input.value = edit.texts.length = formatProjectLength(length, state.measurementSettings, { suffix: false });
  syncInlineEditorWidth(input);
  input.focus({ preventScroll: true });
  input.select();
  window.ZamerAndroid?.showKeyboard?.();
  statusChip.textContent = "Направление зафиксировано · введите размер и нажмите ✓";
  draw();
  return true;
}

function updateSpenBarrel(event, { allowContact = false } = {}) {
  const barrel = spenBarrelButtonPressed(event);
  const pressed = barrel && !spenRuntime.barrelDown;
  spenRuntime.barrelDown = barrel;
  if (!spenSettings.enabled || !spenSettings.sideButton || !barrel || (!allowContact && (event.buttons & 1))) return false;
  if (pressed && !beginSpenLengthInput()) {
    activatePlainSelect();
    statusChip.textContent = "S Pen · Esc / Выбор";
  }
  return true;
}

function clearSpenHover({ preservePreview = false } = {}) {
  window.clearTimeout(spenRuntime.hoverExitTimer);
  spenRuntime.hovering = false;
  spenRuntime.nativeHover = false;
  spenRuntime.point = null;
  spenRuntime.barrelDown = false;
  if (preservePreview) {
    // HOVER_EXIT also precedes tip contact on Android. Keep the displayed
    // snap for this short handover, so contact does not discard its guides.
    spenRuntime.hoverExitAt = performance.now();
    spenRuntime.hoverExitTimer = window.setTimeout(() => {
      if (!spenRuntime.hovering && spenRuntime.contactId === null) {
        resetSnapTracking();
        draw();
      }
    }, 300);
  } else {
    spenRuntime.hoverExitAt = -Infinity;
    resetSnapTracking();
  }
  draw();
}

function updateSpenHover(event) {
  // The native stream owns hover on Android. Ignore WebView's duplicate DOM
  // events, which can be reported as either a mouse or pen depending on version.
  if (spenRuntime.nativeHover || !activateSpenFromPointer(event)) return;
  updateSpenBarrel(event);
  draw();
}

window.addEventListener("zamer-spen-hover", (event) => {
  const detail = event.detail;
  if (detail?.hovering === false) {
    clearSpenHover({ preservePreview: true });
    return;
  }
  const client = nativeSpenClientPoint(detail, { width: window.innerWidth, height: window.innerHeight });
  if (!client || detail.hovering !== true) return;
  window.clearTimeout(spenRuntime.hoverExitTimer);
  activateSpenMode();
  spenRuntime.nativeHover = true;
  spenRuntime.hovering = true;
  spenRuntime.lastHover = performance.now();
  const rect = canvas.getBoundingClientRect();
  const onCanvas = !document.hidden && projectHome.hidden && authScreen.hidden &&
    document.elementFromPoint(client.x, client.y) === canvas;
  spenRuntime.point = onCanvas ? { x: client.x - rect.left, y: client.y - rect.top } : null;
  if (onCanvas) updateSpenBarrel({ buttons: detail.buttons || 0 });
  else {
    spenRuntime.barrelDown = false;
    resetSnapTracking();
  }
  draw();
});
window.addEventListener("blur", () => {
  spenRuntime.contactId = null;
  clearSpenHover();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    spenRuntime.contactId = null;
    clearSpenHover();
  }
});

canvas.addEventListener("pointerover", updateSpenHover);
canvas.addEventListener("pointermove", (event) => {
  if (event.pointerType === "pen") updateSpenHover(event);
});
canvas.addEventListener("pointerleave", (event) => {
  if (event.pointerType === "pen" && !spenRuntime.nativeHover) clearSpenHover({ preservePreview: true });
});

canvas.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  // Finish the current pen/finger gesture before starting one from the other
  // device. A pen and a finger must never be treated as a two-finger pinch.
  if (spenModeEnabled() && event.pointerType === "touch" && spenRuntime.contactId !== null) return;
  if (event.pointerType === "touch" && shouldRejectSpenPalmTouch(spenSettings, spenRuntime, performance.now(), event)) {
    statusChip.textContent = "S Pen рядом · случайное касание ладонью заблокировано";
    return;
  }
  const screen = getPointer(event);
  const displayedSnap = displayedSnapForPress(event, screen);
  if (event.pointerType === "pen") {
    activateSpenFromPointer(event);
    if (spenModeEnabled() && state.activePointers.size > 0) return;
    spenRuntime.nativeHover = false;
    spenRuntime.contactId = event.pointerId;
    if (updateSpenBarrel(event, { allowContact: true })) {
      draw();
      return;
    }
  }
  if (state.tapZoomEnabled && pendingCanvasTap && !tapZoom) {
    if (event.pointerType === "touch" && event.button === 0 &&
        event.timeStamp - pendingCanvasTap.event.timeStamp <= TAP_ZOOM_INTERVAL_MS &&
        pointDistance(pendingCanvasTap.screen, screen) <= DOUBLE_TAP_DISTANCE) {
      window.clearTimeout(pendingCanvasTap.timer);
      tapZoom = { event, screen, scale: state.view.scale, active: false };
    } else {
      finishPendingCanvasTap();
    }
  }
  try {
    canvas.setPointerCapture(event.pointerId);
  } catch {
    // Synthetic or interrupted pointer streams can be missing capture state.
  }
  rememberPointer(event);
  if (state.activePointers.size >= 2) {
    cancelPendingCanvasTap();
    tapZoom = null;
    beginPinchGesture();
    return;
  }
  state.gestureSuppressTap = false;
  if (!tapZoom) {
    startCanvasPointerAction(event, screen);
    if (displayedSnap && pointerPlacesCursorPoint(state.pointer) && sameCursorPreviewContext(displayedSnap.context)) {
      state.pointer.confirmedSnap = displayedSnap;
    }
  }
});

function startCanvasPointerAction(event, screen) {
  if (!selectModeMenu.hidden) hideSelectModeMenu();
  if (numericConfirmInput()) {
    if (state.numericEdit?.figureMetric) cancelFigureMetricInput();
    else if (lineMetricContext()) closeLineMetricInput();
    else closeMetricEntry();
  }
  state.pointerStartedAt = event.timeStamp;
  if (spenModeEnabled() && event.pointerType === "touch") {
    state.pointer = { id: event.pointerId, screen, startScreen: screen, moved: false, mode: "touch-pan" };
    return;
  }
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
    state.pointer = { id: event.pointerId, screen, startScreen: screen, moved: false,
      mode: "select-only", tapCandidateId: pickEntity(screen) };
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
    if (figureGrip) {
      state.pointer = { id: event.pointerId, screen, startScreen: screen, moved: false,
        mode: "figure-grip", grip: figureGrip, preview: null };
      return;
    }
    const selectedLineEndpoint = state.selectedIds.length === 1 ? pickSelectedLineEndpoint(screen) : null;
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
    if (spenModeEnabled() && event.pointerType === "pen" && state.selectTool === "select" && viewportIsSelecting() && !dimensionControl) {
      state.pointer = { id: event.pointerId, screen, startScreen: screen, moved: false,
        mode: "select-only", tapCandidateId: hitId, penWindowCandidate: true };
      return;
    }
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
  const canMoveHit = Boolean(canDragEntityDirectly(hitEntity) && hitIsSelected && state.tool === "select" && selectedEntities().length === 1);
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
}

function cancelPendingCanvasTap() {
  window.clearTimeout(pendingCanvasTap?.timer);
  pendingCanvasTap = null;
}

function finishPendingCanvasTap() {
  const tap = pendingCanvasTap;
  cancelPendingCanvasTap();
  if (tap && state.pointer === tap.pointer) finishCanvasPointerAction(tap.event);
}

function resumeSecondCanvasTap() {
  const second = tapZoom;
  tapZoom = null;
  finishPendingCanvasTap();
  startCanvasPointerAction(second.event, second.screen);
}

function updateTapZoom(event, screen) {
  const dx = screen.x - tapZoom.screen.x;
  const dy = screen.y - tapZoom.screen.y;
  if (!tapZoom.active) {
    const intent = tapZoomMoveIntent(dx, dy, TAP_MOVE_TOLERANCE);
    if (intent === "wait") return true;
    if (intent !== "zoom") {
      resumeSecondCanvasTap();
      return false;
    }
    cancelPendingCanvasTap();
    clearSelectionDrag();
    resetSnapTracking();
    state.pointer = null;
    state.lastAnnotationTap = null;
    state.dimensionSnapHint = null;
    tapZoom.active = true;
  }
  zoomAtScreen(centerScreen(), tapZoomScale(tapZoom.scale, dy, TAP_ZOOM_PIXELS_PER_DOUBLING));
  draw();
  return true;
}

canvas.addEventListener("pointermove", (event) => {
  if (!state.activePointers.has(event.pointerId)) return;
  rememberPointer(event);
  if (state.activePointers.size >= 2) {
    if (!state.pinch) beginPinchGesture();
    updatePinchGesture();
    return;
  }
  const screen = getPointer(event);
  if (state.pointer?.id === event.pointerId && pointDistance(screen, state.pointer.startScreen) > TAP_MOVE_TOLERANCE) {
    state.pointer.confirmedSnap = null;
  }
  if (tapZoom?.event.pointerId === event.pointerId && updateTapZoom(event, screen)) return;
  if (state.pinch || state.gestureSuppressTap || !state.pointer || state.pointer.id !== event.pointerId) return;
  const isDragging = Boolean(event.buttons & 1) || event.pointerType === "touch";
  if (!isDragging) return;
  const penGesture = spenModeEnabled() && event.pointerType === "pen";
  const penPlacesPoint = penGesture && (["survey-point", "dimension-attach", "line-edit", "endpoint-place", "move-command", "offset-command"].includes(state.pointer.mode) ||
    (state.pointer.mode === "pan" && state.tool !== "select" && !state.leaderInput));
  if (penPlacesPoint) {
    // The preview follows the pen; lifting it commits the current point.
    // Do not translate the viewport or suppress this placement as a pan.
    state.pointer.screen = screen;
    draw();
    return;
  }
  const travel = Math.hypot(screen.x - state.pointer.startScreen.x, screen.y - state.pointer.startScreen.y);
  if (travel > TAP_MOVE_TOLERANCE) {
    window.clearTimeout(state.pointer.selectionHoldTimer);
    state.pointer.moved = true;
  }
  if (startPenSelectionDrag(screen)) {
    draw();
    return;
  }
  if (state.pointer.mode === "select-only") {
    if (penGesture) { draw(); return; }
    state.pointer.mode = activationGestureMode(state.pointer.moved);
    if (state.pointer.mode === "select-only") return;
    // This gesture belongs to the viewport, even while crossing other objects.
    // Do not activate or move the object when the finger is released.
    state.pointer.tapCandidateId = null;
  }
  if (state.pointer.mode === "touch-pan") {
    if (!state.pointer.moved) return;
    state.view.panX += screen.x - state.pointer.screen.x;
    state.view.panY += screen.y - state.pointer.screen.y;
    state.pointer.screen = screen;
    resetSnapTracking();
    statusChip.textContent = "Перемещение вида пальцем";
    draw();
    return;
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
    const release = penGesture ? "перо" : "палец";
    statusChip.textContent = state.pointer.mode === "selection-lasso" ? `Лассо: отпустите ${release} для выбора` : `Выделение: отпустите ${release} для выбора`;
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
  } else if (!penGesture) {
    state.dimensionSnapHint = null;
    state.view.panX += screen.x - state.pointer.screen.x;
    state.view.panY += screen.y - state.pointer.screen.y;
  }
  state.pointer.screen = screen;
  draw();
});

canvas.addEventListener("pointerup", finishCanvasPointer);
canvas.addEventListener("pointercancel", (event) => finishCanvasPointer(event, true));
canvas.addEventListener("lostpointercapture", (event) => {
  if (state.activePointers.has(event.pointerId)) finishCanvasPointer(event, true);
});
canvas.addEventListener("contextmenu", (event) => {
  if (event.pointerType === "touch" || event.pointerType === "pen" || event.sourceCapabilities?.firesTouchEvents) event.preventDefault();
});

function finishCanvasPointer(event, canceled = false) {
  try {
    finishCanvasPointerEvent(event, canceled);
  } finally {
    if (spenRuntime.contactId === event.pointerId) spenRuntime.contactId = null;
  }
}

function finishCanvasPointerEvent(event, canceled = false) {
  if (!canceled && state.pointer?.id === event.pointerId) startPenSelectionDrag(getPointer(event));
  if (state.pointer?.id === event.pointerId && pointDistance(getPointer(event), state.pointer.startScreen) > TAP_MOVE_TOLERANCE) {
    state.pointer.confirmedSnap = null;
  }
  if (event.pointerType === "pen") {
    if (canceled) clearSpenHover();
    else {
      activateSpenFromPointer(event);
      spenRuntime.barrelDown = spenBarrelButtonPressed(event);
    }
  }
  const isSecondTap = tapZoom?.event.pointerId === event.pointerId;
  if (isSecondTap) {
    if (tapZoom.active || canceled) {
      const zoomed = tapZoom.active;
      cancelPendingCanvasTap();
      tapZoom = null;
      forgetPointer(event);
      releaseCanvasPointer(event);
      clearSelectionDrag();
      state.pointer = null;
      state.lastAnnotationTap = null;
      if (zoomed && !state.lineEdit) statusChip.textContent = `Масштаб ${viewportScaleLabel()}`;
      draw();
      return;
    }
    resumeSecondCanvasTap();
  }
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
  const screen = getPointer(event);
  if (shouldDelayTapZoom({ enabled: state.tapZoomEnabled, secondTap: isSecondTap, pointerType: event.pointerType,
      button: event.button, moved: state.pointer.moved, mode: state.pointer.mode,
      duration: event.timeStamp - state.pointerStartedAt, distance: pointDistance(state.pointer.startScreen, screen) },
      { longPress: LONG_PRESS_SELECT_MS, tolerance: TAP_MOVE_TOLERANCE })) {
    // Preserve the original gesture everywhere: a second tap can zoom even over an object.
    pendingCanvasTap = { event, screen, pointer: state.pointer, timer: window.setTimeout(finishPendingCanvasTap, TAP_ZOOM_INTERVAL_MS) };
    return;
  }
  finishCanvasPointerAction(event);
}

function finishCanvasPointerAction(event) {
  const touchPan = state.pointer?.mode === "touch-pan";
  const penGesture = spenModeEnabled() && event.pointerType === "pen";
  const overlap = touchPan ? null : overlappingSelectionForTap(event, state.pointer);
  state.selectionPickCycle = null;
  const annotation = touchPan || overlap ? null : annotationForDoubleTap(event, state.pointer);
  if (touchPan) {
    if (state.pointer.moved) statusChip.textContent = "Вид перемещён пальцем";
  } else if (overlap) {
    state.lastAnnotationTap = null;
    state.dimensionPickCycle = null;
    applyTapSelection(overlap.id);
    state.directManipulationIds.add(overlap.id);
    state.selectionPickCycle = overlap;
  } else if (state.pointer.mode === "survey-point") {
    if (!state.pointer.moved) commitSurveyPoint();
  } else if (state.pointer.mode === "dimension-attach") {
    if (!state.pointer.moved && state.dimensionAttach) commitDimensionAttach();
  } else if (state.pointer?.mode === "select-only") {
    if (!state.pointer.moved) {
      const hitId = state.pointer.tapCandidateId;
      applyTapSelection(hitId);
      if (state.selectedIds.includes(hitId)) state.directManipulationIds.add(hitId);
      if (state.selectTool !== "multi" && state.selectedIds.includes(hitId)) {
        const entity = state.entities.find(item => item.id === hitId);
        if (entity?.dimensionKind === "angular") statusChip.textContent = "Угол выбран. Тяните дугу или точку измерения";
        else if (penGesture) statusChip.textContent = "Объект выбран. Пером можно протянуть рамку";
        else statusChip.textContent = canDragEntityDirectly(entity)
          ? "Объект активирован. Теперь его можно перетащить"
          : "Объект выбран. Для перемещения нажмите «Переместить»";
      }
    }
  } else if (state.pointer?.mode === "selection-window" || state.pointer?.mode === "selection-lasso") {
    if (state.pointer.moved) {
      if (penGesture) updateSelectionDrag(getPointer(event));
      finishSelectionDrag();
    } else {
      clearSelectionDrag();
      applyTapSelection(pickEntity(state.pointer.startScreen));
      draw();
    }
  } else if (state.pointer?.mode === "move-command") {
    if (!state.pointer.moved) {
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
    if (!state.pointer.moved) pickLineEditPoint(penGesture ? getPointer(event) : state.pointer.startScreen);
  } else if (state.pointer.mode === "quick-trim-once") {
    if (!state.pointer.moved) applyQuickEdit("trim", state.pointer.startScreen);
  } else if (state.pointer?.mode === "offset-command") {
    if (!state.pointer.moved) {
      commitOffsetCommandPoint(cursorWorld());
    } else {
      draw();
      forceMoveCursorVisible();
    }
  } else if (state.pointer?.mode === "endpoint-place") {
    if (!state.pointer.moved) {
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
      commitCursorPoint(penGesture ? getPointer(event) : state.pointer.startScreen);
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

function repeatedSelectionAt(screen) {
  const cycle = state.selectionPickCycle;
  const { scale, panX, panY } = state.view;
  return cycle && state.selectedIds.includes(cycle.id) &&
    cycle.view.scale === scale && cycle.view.panX === panX && cycle.view.panY === panY &&
    pointDistance(cycle.screen, screen) <= SELECTION_CYCLE_DISTANCE ? cycle : null;
}

function overlappingSelectionForTap(event, pointer) {
  // A selected figure/line grip always wins over another object sharing the same point.
  if (pointer.mode === "figure-grip" || (pointer.mode === "line-grip" && pointer.grip.point !== "middle")) return null;
  if (event.button !== 0 || event.ctrlKey || event.shiftKey || event.altKey || event.metaKey || pointer.moved ||
      state.copyPicking || state.selectTool !== "select" || !viewportIsSelecting() || surveyPointPicker ||
      event.timeStamp - state.pointerStartedAt >= LONG_PRESS_SELECT_MS ||
      pointDistance(pointer.startScreen, getPointer(event)) > TAP_MOVE_TOLERANCE) return null;
  const groups = new Set();
  const candidates = pickEntityIds(pointer.startScreen).filter((id) => {
    const group = state.entities.find((entity) => entity.id === id)?.groupId;
    if (!group) return true;
    if (groups.has(group)) return false;
    groups.add(group);
    return true;
  });
  if (candidates.length < 2) return null;
  const previous = repeatedSelectionAt(pointer.startScreen);
  const ids = previous ? [...previous.ids.filter(id => candidates.includes(id)),
    ...candidates.filter(id => !previous.ids.includes(id))] : candidates;
  const index = previous ? (ids.indexOf(previous.id) + 1) % ids.length : 0;
  return { id: ids[index], ids, screen: previous?.screen ?? pointer.startScreen, view: { ...state.view } };
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
  if (!tapZoom) finishPendingCanvasTap();
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
  if (!tapZoom) finishPendingCanvasTap();
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

function closeQuickMeasure() {
  setTool("select");
  quickMeasureUi.button.focus({ preventScroll: true });
}

quickMeasureUi.button.querySelector("span").innerHTML = cadIcon("measure");
bindPointAction(quickMeasureUi.button, () => {
  if (state.quickMeasure) return closeQuickMeasure();
  prepareToolbarMenu(quickMeasureUi.panel);
  setSelection(null);
  setTool("quick-measure");
  configureQuickMeasure("distance");
  canvas.focus({ preventScroll: true });
});
for (const button of quickMeasureModeButtons) {
  bindPointAction(button, () => {
    const { measureMode } = button.dataset;
    if (state.quickMeasure && state.quickMeasure.mode !== measureMode) configureQuickMeasure(measureMode);
  });
}
for (const button of quickMeasureMethodButtons) {
  bindPointAction(button, () => {
    const { measureMethod } = button.dataset;
    if (state.quickMeasure && state.quickMeasure.method !== measureMethod) configureQuickMeasure(state.quickMeasure.mode, measureMethod);
  });
}
bindPointAction(quickMeasureUi.finish, finishQuickMeasureContour);
bindPointAction(quickMeasureUi.close, closeQuickMeasure);

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
  if (additionalDimensionKinds.includes(entity.dimensionKind)) {
    const anchor = { x: entity.x1 + dx, y: entity.y1 + dy };
    const label = { x: entity.x2 + dx, y: entity.y2 + dy };
    const translated = Object.fromEntries(Object.entries(additionalDimensionPoints(entity))
      .map(([key, point]) => [key, { x: point.x + dx, y: point.y + dy }]));
    return [anchor, label, ...Object.values(translated)].every(isLinePoint)
      ? { x1: anchor.x, y1: anchor.y, x2: label.x, y2: label.y, ...translated } : null;
  }
  if (isRadialDimension(entity)) {
    const start = { x: entity.x1 + dx, y: entity.y1 + dy };
    const end = { x: entity.x2 + dx, y: entity.y2 + dy };
    const rim = entity.radialRim && { x: entity.radialRim.x + dx, y: entity.radialRim.y + dy };
    return [start, end, ...(rim ? [rim] : [])].every(isLinePoint)
      ? { x1: start.x, y1: start.y, x2: end.x, y2: end.y, ...(rim ? { radialRim: rim } : {}) } : null;
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
  if (isReusableBlock(entity)) {
    const point = { x: entity.x + dx, y: entity.y + dy };
    return !entity.parts.some(part => isLayerLocked(part.layer)) && expandReusableBlock({ ...entity, ...point }) ? point : null;
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
  const locked = sources.find((entity) => isLayerLocked(entity.layer));
  if (locked) {
    statusChip.textContent = layerLockMessage(locked.layer || DEFAULT_LINE_LAYER);
    return;
  }
  const count = command.copyMode === "array" ? copyArrayCount(sources.length) : 1;
  if (!count || !sources.length || sources.length * count > maxCopiesPerPlacement) {
    statusChip.textContent = "Укажите от 2 до 50 копий для тиража и не более 1000 объектов за раз";
    return;
  }
  const movingIds = copyMovingIds(sources);
  const copies = [];
  for (let step = 1; step <= count; step += 1) {
    const copiedIds = new Map(sources.map(entity => [entity.id, newLineId(entity.type)]));
    const copiedGroups = new Map();
    for (const entity of sources) {
      const geometry = translatedEntityGeometry(entity, dx * step, dy * step, movingIds);
      const original = cloneProjectEntity(entity);
      if (!geometry || !original) {
        statusChip.textContent = "Координаты копии вне диапазона";
        return;
      }
      const copy = { ...original, ...geometry, id: copiedIds.get(entity.id) };
      if (entity.groupId) {
        if (!copiedGroups.has(entity.groupId)) copiedGroups.set(entity.groupId, newLineId("group"));
        copy.groupId = copiedGroups.get(entity.groupId);
      }
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

function assignEntityGeometry(entity, geometry) {
  for (const [key, value] of Object.entries(geometry)) {
    if (value === undefined) delete entity[key];
    else entity[key] = value;
  }
  if (entity.dimensionKind === "leader" && entity.leaderElbow === null) delete entity.leaderElbow;
}

function rotatedEntitySnapshot(entity, base, radians) {
  const rotated = rotateStoredEntity(entity, base, radians);
  if (!rotated || !validStoredEntity(rotated) || (isReusableBlock(rotated) && !expandReusableBlock(rotated))) return null;
  return cloneProjectEntity(rotated);
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
  if (isLayerLocked(entity.layer)) return;
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

function additionalDimensionPoints(entity) {
  const keys = ["arcStart", "arcThrough", "arcEnd", "jogCenter", "jogRim", "measureEnd"];
  return Object.fromEntries(keys.filter(key => entity[key]).map(key => [key, { ...entity[key] }]));
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
    return { x: entity.x, y: entity.y, text: entity.text || "", height: entity.height || 260,
      rotation: entity.rotation || 0, textWidth: Number.isFinite(entity.textWidth) ? entity.textWidth : undefined,
      textFrame: Boolean(entity.textFrame) };
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
  if (additionalDimensionKinds.includes(entity.dimensionKind)) return { ...geometry, ...additionalDimensionPoints(entity) };
  if (isRadialDimension(entity)) return { ...geometry, ...(entity.radialRim ? { radialRim: { ...entity.radialRim } } : {}) };
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
  if (!entity || !geometry || isLayerLocked(entity.layer) || (Object.hasOwn(geometry, "layer") && isLayerLocked(geometry.layer))) return;
  assignEntityGeometry(entity, geometry);
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

function pickEntityIds(screen) {
  const objects = [];
  const edges = [];
  const interiors = [];
  const labels = new Set();
  const world = screenToWorld(screen);
  for (let i = state.entities.length - 1; i >= 0; i -= 1) {
    const entity = state.entities[i];
    if (!entityMatchesSelectionFilter(entity)) continue;
    if (entity.type === "block" && !isReusableBlock(entity)) {
      if (pointInsideBlock(screen, entity)) objects.push({ id: entity.id, distance: 0 });
      continue;
    }
    const distance = distanceToEntityScreen(screen, entity);
    if (isPlanAnnotationZone(entity)) {
      const label = zoneLabelRects.get(entity.id);
      if (label && screenRectDistance(screen, label) === 0) labels.add(entity.id);
      else if (distance < 18) edges.push({ id: entity.id, distance });
      else {
        const ring = planAnnotationGeometry(entity)?.rings.find((entry) => pointInPolygon(world, entry.points));
        if (ring) interiors.push({ id: entity.id, area: ring.areaMm2 });
      }
    } else if (distance < 18) {
      objects.push({ id: entity.id, distance });
    }
  }
  const byDistance = (a, b) => a.distance - b.distance;
  return [
    ...objects.sort(byDistance).map(({ id }) => id),
    ...[...zoneLabelRects.keys()].reverse().filter(id => labels.has(id)),
    ...edges.sort(byDistance).map(({ id }) => id),
    ...interiors.sort((a, b) => a.area - b.area).map(({ id }) => id),
  ];
}

function pickEntity(screen) {
  return pickEntityIds(screen)[0] ?? null;
}

function pickLineEndpoint(screen) {
  let best = null;
  let bestDistance = 18;
  for (let i = state.entities.length - 1; i >= 0; i -= 1) {
    const entity = state.entities[i];
    if ((entity.type !== "line" && entity.type !== "wall") || entity.dimensionKind || entity.layer === "dimensions" ||
        !isLayerVisible(entity.layer) || isLayerLocked(entity.layer) || !traceMatchesEditingContext(entity)) continue;
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
  const entities = [state.entities.find((item) => item.id === state.selectedId)];
  let best = null;
  for (const entity of entities) {
    const grip = nearestLineEndpoint(entity, screen);
    if (!grip || (best && best.distance <= grip.distance)) continue;
    best = grip;
  }
  return best;
}

function nearestLineEndpoint(entity, screen) {
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
      best = { entityId: entity.id, point: endpoint.point, distance };
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
  if (isReusableBlock(entity)) return Math.min(...(expandReusableBlock(entity) ?? [])
    .filter(part => isLayerVisible(part.layer)).map(part => distanceToEntityScreen(screen, part)));
  if (isPlanAnnotationZone(entity)) {
    const geometry = planAnnotationGeometry(entity);
    if (!geometry) return Infinity;
    const label = zoneLabelRects.get(entity.id);
    let closest = label ? screenRectDistance(screen, label) : pointDistance(screen, worldToScreen(geometry.anchor));
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
    const layout = textBlockLayout(entity);
    const height = layout.height * state.view.scale;
    const width = layout.width * state.view.scale;
    const padding = layout.frame ? height * 0.25 : 0;
    const bottom = (layout.lines.length - 1) * height * ANNOTATION_LINE_SPACING + height * 0.22;
    const radians = -((entity.rotation || 0) * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const dx = screen.x - origin.x;
    const dy = screen.y - origin.y;
    const localX = dx * cos - dy * sin;
    const localY = dx * sin + dy * cos;
    if (localX >= -8 - padding && localX <= width + 8 + padding &&
        localY >= -height - 8 - padding && localY <= bottom + 8 + padding) return 0;
    const clampedX = Math.max(-padding, Math.min(width + padding, localX));
    const clampedY = Math.max(-height - padding, Math.min(bottom + padding, localY));
    return Math.hypot(localX - clampedX, localY - clampedY);
  }
  if (additionalDimensionKinds.includes(entity.dimensionKind)) {
    const art = additionalDimensionArtwork(entity, state.annotationScale);
    if (!art) return Infinity;
    let nearest = pointDistance(screen, worldToScreen(art.label));
    for (const path of additionalDimensionPaths(art)) {
      for (let index = 1; index < path.length; index += 1) {
        nearest = Math.min(nearest, pointToSegmentDistance(screen, worldToScreen(path[index - 1]), worldToScreen(path[index])));
      }
    }
    return nearest;
  }
  if (isRadialDimension(entity)) {
    const art = radialDimensionArtwork(entity, state.annotationScale);
    if (!art) return Infinity;
    return Math.min(pointDistance(screen, worldToScreen(art.label)),
      pointToSegmentDistance(screen, worldToScreen(art.start), worldToScreen(art.end)),
      art.landing ? pointToSegmentDistance(screen, worldToScreen(art.rim), worldToScreen(art.label)) : Infinity);
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
escapeSelectButton?.addEventListener("click", activatePlainSelect);

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

bindPointAction(figureToolButton, (event) => {
  if (drawToolMenu.hidden) {
    showDrawToolMenu();
    if (event.type === "click") {
      const firstOption = drawToolMenu.querySelector("button[aria-pressed='true']") || drawToolButtons[0];
      firstOption?.focus({ preventScroll: true });
    }
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

for (const button of drawToolButtons) {
  bindPointAction(button, (event) => {
    selectDrawTool(button.dataset.drawTool);
    if (event.type === "click") figureToolButton.focus({ preventScroll: true });
  });
}

bindPointAction(document.getElementById("finishDimensionChain"), activatePlainSelect);

ordinateModes.addEventListener("click", event => {
  const axis = event.target.closest("[data-ordinate-axis]")?.dataset.ordinateAxis;
  if (!axis) return;
  state.ordinateAxis = axis;
  for (const button of ordinateModes.querySelectorAll("button")) {
    button.setAttribute("aria-pressed", String(button.dataset.ordinateAxis === axis));
  }
  draw();
});
radialModes.addEventListener("click", event => {
  const mode = event.target.closest("[data-radial-mode]")?.dataset.radialMode;
  if (!mode) return;
  state.radialMode = mode;
  for (const button of radialModes.querySelectorAll("button")) {
    button.setAttribute("aria-pressed", String(button.dataset.radialMode === mode));
  }
  draw();
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

revisionCloudControls.addEventListener("click", (event) => {
  const mode = event.target.closest("[data-revision-cloud-mode]")?.dataset.revisionCloudMode;
  if (mode && !state.drawing) {
    state.revisionCloudMode = mode;
    statusChip.textContent = revisionCloudPrompt();
    canvas.focus({ preventScroll: true });
    draw();
  }
});

revisionCloudFinish.addEventListener("click", () => {
  if (state.drawing?.points.length >= 3) commitRevisionCloud();
  canvas.focus({ preventScroll: true });
});

traceVisibilityButton.addEventListener("click", () => {
  const visible = state.visibleLayers.has(TRACE_LAYER);
  if (visible) {
    setTraceEditing(false);
    state.visibleLayers.delete(TRACE_LAYER);
  } else {
    state.visibleLayers.add(TRACE_LAYER);
  }
  resetSnapTracking();
  markProjectDirty("trace-visibility");
  statusChip.textContent = visible ? "Калька скрыта" : "Калька видна";
  draw();
});

traceEditButton.addEventListener("click", () => {
  setTraceEditing(!state.traceEditing);
  statusChip.textContent = state.traceEditing ? "Выберите линии и фигуры для пометок" : "Правка кальки завершена";
  draw();
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
  const { snapCount, snapIndex } = dimensionCursorSnap(origin);
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

numericStepSelect.addEventListener("change", () => {
  state.numericStep = normalizeNumericStep(Number(numericStepSelect.value));
  markProjectDirty("numeric-step");
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
  if (event.target !== canvas) {
    if (!tapZoom) finishPendingCanvasTap();
    state.lastAnnotationTap = null;
  }
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
      extension: "Продолжение",
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
googleSignInButton.addEventListener("click", signInWithGoogle);
window.addEventListener("online", () => scheduleGoogleSync(apkUser.id, 0));
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) scheduleGoogleSync(apkUser.id, 0);
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
  createProject({
    name,
    template: "blank",
    project: { theme: shell.dataset.theme, snaps: NEW_PROJECT_SNAPS, polarStep: NEW_PROJECT_POLAR_STEP },
  }).catch((error) => {
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
      if (state.numericEdit?.figureMetric) cancelFigureMetricInput();
      else if (lineMetricContext()) cancelLineMetricInput();
      else {
        if (selectedRectangleForMetrics()) modifiedMetricInputs.delete(input);
        closeMetricEntry();
      }
      canvas.focus({ preventScroll: true });
      draw();
    }
  });
  input.addEventListener("input", () => {
    syncInlineEditorWidth(input);
    if (state.numericEdit?.figureMetric) updateFigureMetricInput(input);
    else if (lineMetricContext()) updateLineMetricInput(input);
    else {
      modifiedMetricInputs.add(input);
      input.removeAttribute("aria-invalid");
      if (steppedMetricInput === input || !(selectedRectangleForMetrics() && (input === topLengthInput || input === topAngleInput))) {
        apply(kind, { recordUndo: false });
      }
    }
  });
  input.addEventListener("blur", (event) => {
    if (steppedMetricInput) return;
    if (state.numericEdit?.figureMetric) {
      if (event.relatedTarget !== keyboardConfirmButton && !lineMetricKinds.has(event.relatedTarget)) {
        state.numericEdit = null;
        input.removeAttribute("aria-invalid");
        draw();
      }
      return;
    }
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
  if (!edit.quick) setSelection(edit.mode === "fillet" ? edit.filletIds : lineEditEntity(edit.sourceId, edit.mode)?.id);
});
lineUi.lineEditSelective.addEventListener("click", () => {
  const edit = state.lineEdit;
  if (!boundaryEditModes.has(edit?.mode)) return;
  startQuickEdit(edit.mode, { selective: edit.quick });
});
lineUi.lineEditFinish.addEventListener("click", () => endLineEdit("Правка завершена"));
lineUi.lineEditApply.addEventListener("click", applyLineEditPreview);
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
lineUi.lineEditRadius.addEventListener("input", () => {
  if (state.lineEdit?.mode === "fillet") refreshFilletPreview(state.lineEdit);
});
lineUi.lineLengthInput.addEventListener("input", () => {
  const edit = state.lineEdit;
  if (!edit) return;
  edit.pending = null;
  edit.amount = null;
  lineUi.lineLengthInput.removeAttribute("aria-invalid");
  if (edit.mode === "offset" && edit.lengthMode === "distance") {
    if (updateOffsetAmountFromInput(edit)) {
      refreshOffsetPreviewFromCursor(edit);
      setLineEditHint("Перемещайте чертёж: отступ строится со стороны крестика · нажмите ✓");
    } else {
      setLineEditHint("Введите положительное расстояние отступа");
    }
  } else {
    setLineEditHint("Укажите точку с новыми параметрами");
  }
  draw();
});
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
lineUi.lineLengthModes.addEventListener("click", (event) => {
  if (!state.lineEdit) return;
  const mode = event.target.closest("[data-length-mode]")?.dataset.lengthMode;
  if (!mode || mode === state.lineEdit.lengthMode) return;
  state.lineEdit.amount = null;
  state.lineEdit.firstPick = null;
  state.lineEdit.pending = null;
  state.lineEdit.lengthMode = mode;
  syncLineQuantityFields();
  if (state.lineEdit.mode === "offset") {
    if (mode === "through") {
      refreshOffsetPreviewFromCursor(state.lineEdit);
      setLineEditHint("Параллель проходит через крестик · нажмите ✓");
    } else if (updateOffsetAmountFromInput(state.lineEdit)) {
      refreshOffsetPreviewFromCursor(state.lineEdit);
      setLineEditHint("Перемещайте чертёж: отступ строится со стороны крестика · нажмите ✓");
    } else {
      setLineEditHint("Введите расстояние отступа");
    }
  } else if (mode === "through") setLineEditHint("Наведите крестик на точку для параллели");
  else setLineEditHint("Введите значение и нажмите галочку");
  draw();
});
lineUi.lineEditRadius.addEventListener("keydown", (event) => {
  if (event.key === "Enter") lineUi.lineEditRadius.blur();
});
document.addEventListener("keydown", (event) => {
  if (!tapZoom) finishPendingCanvasTap();
  if (state.blockPlacement && event.key === "Escape" && !event.target.closest("dialog")) {
    event.preventDefault();
    activatePlainSelect();
    return;
  }
  if (state.quickMeasure && event.key === "Escape" && !event.defaultPrevented && !event.target.closest("dialog")) {
    event.preventDefault();
    closeQuickMeasure();
    return;
  }
  if (event.key === "Escape" && !event.defaultPrevented && !event.target.closest("dialog") &&
      (state.leaderInput || leaderToolActive() || state.tool === "text")) {
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
  if (event.key === "Escape" && !event.target.closest("dialog") && state.actionPicking) {
    event.preventDefault();
    closeSelectionActionPicker();
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
  if ((state.tool === "revision-cloud" || state.traceOptions) && event.key === "Escape" && !event.target.closest("dialog")) {
    event.preventDefault();
    activatePlainSelect();
    return;
  }
  if (state.planZone && event.key === "Escape" && !event.target.closest("dialog")) {
    event.preventDefault();
    activatePlainSelect();
    return;
  }
  if (state.tool === "circle" && state.circleMode !== "center" && event.key === "Escape" && !event.target.closest("dialog")) {
    event.preventDefault();
    activatePlainSelect();
    return;
  }
  if (state.tool === "dimension" && ["chain", "radial", ...additionalDimensionKinds].includes(state.dimensionTool) && event.key === "Escape") {
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

const objectPropertiesDialog = document.getElementById("objectPropertiesDialog");
const objectPropertiesForm = document.getElementById("objectPropertiesForm");
const objectPropertiesFields = document.getElementById("objectPropertiesFields");
const objectPropertiesError = document.getElementById("objectPropertiesError");
let objectPropertiesTarget = null;

function objectPropertyDetails(entity) {
  if (entity.dimensionKind || isPlanAnnotationZone(entity)) return { position: null, fields: [] };
  if (entity.type === "circle") return {
    position: { x: entity.cx, y: entity.cy },
    fields: [["radius", "Радиус, мм", entity.radius, linePointEpsilon]],
  };
  if (entity.type === "arc") {
    const arc = arcGeometry(entity.start, entity.through, entity.end);
    return { position: entity.start, fields: arc ? [["radius", "Радиус, мм", arc.radius, distanceWorld(entity.start, entity.end) / 2]] : [] };
  }
  if (entity.type === "polyline") return {
    position: entity.points[0], fields: [["vertices", "Вершин", entity.points.length, null]],
  };
  if (entity.type === "text") return {
    position: entity,
    fields: [["height", "Высота текста, мм", entity.height || 260, linePointEpsilon],
      ["rotation", "Поворот, °", entity.rotation || 0, -Infinity]],
  };
  if (entity.type === "block") return {
    position: entity, fields: [["rotation", "Поворот, °", entity.rotation || 0, -Infinity]],
  };
  const position = { x: entity.x1, y: entity.y1 };
  const dx = entity.x2 - entity.x1;
  const dy = entity.y2 - entity.y1;
  if (entity.type === "rectangle") return { position, fields: [["width", "Ширина, мм", Math.abs(dx), linePointEpsilon],
    ["height", "Высота, мм", Math.abs(dy), linePointEpsilon]] };
  if (isValidLine(entity)) return { position, fields: [["length", "Длина, мм", Math.hypot(dx, dy), linePointEpsilon],
    ["angle", "Угол, °", normalizeDegrees(radToDeg(Math.atan2(dy, dx))), -Infinity]] };
  return { position: null, fields: [] };
}

function openObjectProperties(entity) {
  const { position, fields } = objectPropertyDetails(entity);
  const layerId = entity.layer || DEFAULT_LINE_LAYER;
  const locked = isLayerLocked(layerId);
  const assignable = layerId !== TRACE_LAYER && canAssignEntityToLineLayer(entity);
  objectPropertiesTarget = { entity, position };
  document.getElementById("objectPropertiesType").textContent = viewportObjectLabel(entity);
  objectPropertiesError.hidden = true;
  objectPropertiesFields.replaceChildren();
  const layerField = document.createElement("label");
  layerField.className = "survey-field object-property-layer";
  const caption = document.createElement("span");
  caption.textContent = locked ? "Слой заблокирован" : "Слой";
  const layerSelect = document.createElement("select");
  layerSelect.name = "layer";
  layerSelect.disabled = locked || !assignable;
  for (const id of new Set([layerId, ...(assignable && !locked ? availableLineLayerIds() : [])])) {
    layerSelect.append(new Option(drawingLayerInfo(id)?.name || id, id, false, id === layerId));
  }
  layerField.append(caption, layerSelect);
  objectPropertiesFields.append(layerField);
  if (assignable) {
    const colorField = document.createElement("label");
    colorField.className = "survey-field object-property-style";
    const colorCaption = document.createElement("span");
    colorCaption.textContent = "Цвет линии";
    const colorControls = document.createElement("div");
    colorControls.className = "object-property-color";
    const customColor = document.createElement("input");
    customColor.type = "checkbox";
    customColor.name = "customColor";
    customColor.checked = Boolean(normalizeLineLayerColor(entity.color));
    customColor.disabled = locked;
    customColor.setAttribute("aria-label", "Свой цвет линии");
    const customColorText = document.createElement("span");
    customColorText.textContent = "Свой";
    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.name = "color";
    colorInput.value = normalizeLineLayerColor(entity.color) || drawingLayerInfo(layerId)?.color || "#26313d";
    colorInput.disabled = locked || !customColor.checked;
    customColor.addEventListener("change", () => { colorInput.disabled = locked || !customColor.checked; });
    layerSelect.addEventListener("change", () => {
      if (!customColor.checked) colorInput.value = drawingLayerInfo(layerSelect.value)?.color || "#26313d";
    });
    colorControls.append(customColor, customColorText, colorInput);
    colorField.append(colorCaption, colorControls);

    const weightField = document.createElement("label");
    weightField.className = "survey-field object-property-style";
    const weightCaption = document.createElement("span");
    weightCaption.textContent = "Вес линии";
    const weightSelect = document.createElement("select");
    weightSelect.name = "lineWeight";
    weightSelect.disabled = locked;
    weightSelect.append(new Option("По слою", "layer", false, normalizeLineWeight(entity.lineWeight) === null));
    for (const weight of LINE_WEIGHT_VALUES) {
      weightSelect.append(new Option(lineWeightLabel(weight), String(weight), false, normalizeLineWeight(entity.lineWeight) === weight));
    }
    weightField.append(weightCaption, weightSelect);
    objectPropertiesFields.append(colorField, weightField);
  }
  document.getElementById("applyObjectProperties").hidden = locked || (!position && !assignable);
  for (const [name, title, value, minimum] of [
    ...(position ? [["positionX", "X, мм", position.x, -MAX_LINE_COORDINATE], ["positionY", "Y, мм", position.y, -MAX_LINE_COORDINATE]] : []), ...fields,
  ]) {
    const label = document.createElement("label");
    const nameElement = document.createElement("span");
    const wrapper = document.createElement("div");
    const input = document.createElement("input");
    label.className = "survey-field";
    nameElement.textContent = title;
    wrapper.className = "numeric-stepper-field";
    input.type = "text";
    input.inputMode = "decimal";
    input.name = name;
    input.id = `object-property-${name}`;
    input.value = formatEditableNumber(value);
    input.defaultValue = input.value;
    input.dataset.original = String(value);
    input.readOnly = minimum === null || locked;
    wrapper.append(input);
    label.append(nameElement, wrapper);
    objectPropertiesFields.append(label);
    if (!input.readOnly) addNumericStepper(input, { getStep: currentNumericStep, limits: () => ({ min: minimum, max: MAX_LINE_COORDINATE }) });
  }
  objectPropertiesDialog.showModal();
  document.getElementById("closeObjectProperties").focus({ preventScroll: true });
}

objectPropertiesDialog.addEventListener("close", () => { objectPropertiesTarget = null; });
document.getElementById("closeObjectProperties").addEventListener("click", () => objectPropertiesDialog.close());
objectPropertiesForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const target = objectPropertiesTarget;
  if (!target || !state.entities.includes(target.entity) || isLayerLocked(target.entity.layer)) return;
  const { entity, position } = target;
  const layer = objectPropertiesForm.elements.namedItem("layer").value;
  if (isLayerLocked(layer)) return;
  const readNumber = (name) => {
    const field = objectPropertiesForm.elements.namedItem(name);
    return field.value === field.defaultValue ? Number(field.dataset.original) : parseLineDecimal(field.value) ?? NaN;
  };
  const before = { ...entityGeometry(entity), layer: entity.layer, color: entity.color, lineWeight: entity.lineWeight };
  const geometry = position ? translatedEntityGeometry(entity, readNumber("positionX") - position.x, readNumber("positionY") - position.y) : {};
  const after = { ...before, ...geometry, layer: layer === (entity.layer || DEFAULT_LINE_LAYER) ? entity.layer : layer };
  if (canAssignEntityToLineLayer(entity)) {
    const customColor = objectPropertiesForm.elements.namedItem("customColor").checked;
    after.color = customColor ? normalizeLineLayerColor(objectPropertiesForm.elements.namedItem("color").value) : undefined;
    const weight = objectPropertiesForm.elements.namedItem("lineWeight").value;
    after.lineWeight = weight === "layer" ? undefined : normalizeLineWeight(weight);
  }
  if (entity.type === "circle") after.radius = readNumber("radius");
  let validArcRadius = true;
  if (entity.type === "arc" && objectPropertiesForm.elements.namedItem("radius")) {
    const radius = readNumber("radius");
    const arc = arcGeometry(entity.start, entity.through, entity.end);
    if (radius !== arc.radius) {
      const { start, end } = after;
      const half = distanceWorld(start, end) / 2;
      const shift = Math.sqrt((radius - half) * (radius + half));
      const halfSweep = normalizeAnglePositive((arc.endAngle - arc.startAngle) * (arc.counterClockwise ? 1 : -1)) / 2;
      const sagitta = (halfSweep > Math.PI / 2 ? radius + shift : half ** 2 / (radius + shift)) * (arc.counterClockwise ? 1 : -1);
      const through = { x: (start.x + end.x) / 2 + (end.y - start.y) * sagitta / (2 * half),
        y: (start.y + end.y) / 2 - (end.x - start.x) * sagitta / (2 * half) };
      validArcRadius = radius >= half && radius <= MAX_LINE_COORDINATE && isLinePoint(through) && Boolean(draftArcFromBend(start, end, through));
      if (validArcRadius) after.through = through;
    }
  }
  if (entity.type === "text") {
    after.height = readNumber("height");
    after.rotation = readNumber("rotation");
  }
  if (entity.type === "block") after.rotation = readNumber("rotation");
  if (entity.type === "rectangle") {
    after.x2 = after.x1 + Math.sign(entity.x2 - entity.x1) * readNumber("width");
    after.y2 = after.y1 + Math.sign(entity.y2 - entity.y1) * readNumber("height");
  }
  if (position && isValidLine(entity) && ["wall", "line"].includes(entity.type)) {
    const length = readNumber("length");
    const angle = normalizeDegrees(readNumber("angle")) * Math.PI / 180;
    after.x2 = after.x1 + (length > 0 ? length : NaN) * Math.cos(angle);
    after.y2 = after.y1 + (length > 0 ? length : NaN) * Math.sin(angle);
  }
  const candidate = { ...entity, ...after };
  if (!geometry || !validArcRadius || !validStoredEntity(candidate) || (editableFigure(candidate) && !validFigurePiece(candidate)) ||
      (entity.type === "circle" && !translatedEntityGeometry(candidate, 0, 0)) ||
      (isReusableBlock(candidate) && !expandReusableBlock(candidate)) ||
      (entity.type === "text" && !(after.height > 0 && after.height <= MAX_LINE_COORDINATE))) {
    objectPropertiesError.textContent = "Проверьте координаты и размеры объекта";
    objectPropertiesError.hidden = false;
    return;
  }
  if (geometryChanged(before, after)) {
    applyEntityGeometry(entity, after);
    state.visibleLayers.add(layer);
    state.undo.push({ type: "move", entityId: entity.id, before, after });
    state.redo.length = 0;
    statusChip.textContent = "Свойства объекта изменены";
    draw();
  }
  objectPropertiesDialog.close();
});

selectToolMenu.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  applySelectionAction(button.dataset.action);
});
blockPaletteButton.addEventListener("click", () => {
  if (blockPaletteDialog.open) return;
  hideDrawToolMenu();
  if (state.traceEditing) {
    statusChip.textContent = "Завершите работу с калькой перед вставкой блока";
    draw();
    return;
  }
  setBlockPaletteSearch(false);
  renderBlockPalette();
  blockPaletteDialog.showModal();
});
document.getElementById("closeBlockPalette").addEventListener("click", () => blockPaletteDialog.close());
blockPaletteDialog.addEventListener("close", updateViewportLock);
blockPaletteSearchToggle.addEventListener("click", () => {
  const open = blockPaletteSearch.hidden;
  setBlockPaletteSearch(open);
  filterBlockPalette();
  if (open) blockPaletteSearchInput.focus({ preventScroll: true });
  else blockPaletteSearchToggle.focus({ preventScroll: true });
});
blockPaletteSearchInput.addEventListener("input", filterBlockPalette);
blockPaletteSearchInput.addEventListener("blur", () => window.setTimeout(updateViewportLock, 0));
blockPaletteSearchClear.addEventListener("click", () => {
  blockPaletteSearchInput.value = "";
  filterBlockPalette();
  blockPaletteSearchInput.focus({ preventScroll: true });
});
blockPaletteList.addEventListener("click", event => {
  const insert = event.target.closest("button[data-insert-block]")?.dataset.insertBlock;
  const remove = event.target.closest("button[data-remove-block]")?.dataset.removeBlock;
  const definition = state.reusableBlocks.find(({ id }) => id === (insert || remove));
  if (!definition) return;
  if (insert) startBlockPlacement(definition);
  else changeBlockLibrary(state.reusableBlocks.filter(({ id }) => id !== definition.id));
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
        event.clientY >= bounds.top && event.clientY <= bounds.bottom) action(event);
  });
  button.addEventListener("lostpointercapture", (event) => {
    if (press?.pointerId === event.pointerId) press = null;
  });
  button.addEventListener("click", (event) => {
    if (event.detail === 0) action(event);
  });
}

bindPointAction(keyboardConfirmButton, confirmKeyboardInput);
bindPointAction(viewportCoordinates, () => {
  state.lastAnnotationTap = null;
  centerViewOnWorldPoint(projectOrigin);
  resetSnapTracking();
  viewportActionStatus.textContent = "Крестик на начале координат";
  draw();
});
keyboardConfirmButton.addEventListener("blur", (event) => {
  if (!keyboardInputs.includes(event.relatedTarget) && !linePointAssist.contains(event.relatedTarget)) {
    clearLineMetricEdit();
    window.setTimeout(updateViewportLock, 0);
  }
});
bindPointAction(polylineArcMode, togglePolylineArcMode);
bindPointAction(quickMirrorTool, () => {
  if (state.lineEdit?.mode === "mirror") endLineEdit("Отражение отменено");
  else startSelectionAction("mirror");
});
lineUi.lineMirrorModes.addEventListener("click", event => {
  const axis = event.target.closest("[data-mirror-axis]")?.dataset.mirrorAxis;
  const edit = state.lineEdit;
  if (edit?.mode !== "mirror" || !axis) return;
  const sources = lineEditSources(edit);
  if (!sources.length || sources.length !== edit.sourceIds.length) return endLineEdit("Объекты недоступны");
  edit.pending = null;
  edit.mirrorAxis = null;
  edit.mirrorStart = null;
  edit.pickMirrorAxis = axis === "line";
  if (edit.pickMirrorAxis) {
    resetSnapTracking();
    setLineEditHint("Ось отражения: укажите первую точку");
    draw();
    return;
  }
  const bounds = selectionWorldBounds(sources);
  if (!bounds) return;
  const center = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
  const end = axis === "vertical" ? { x: center.x, y: center.y + (center.y > 0 ? -1 : 1) } : { x: center.x + (center.x > 0 ? -1 : 1), y: center.y };
  previewMirror(sources[0], center, end);
});
function closeSelectionActionPicker({ updateStatus = true } = {}) {
  if (state.actionPicking) state.selectTool = "select";
  state.actionPicking = null;
  selectionActionLabel.hidden = true;
  if (!state.copyPicking && state.moveCommand?.copyMode !== "array") copyControls.hidden = true;
  if (updateStatus) statusChip.textContent = selectedEntities().length ? `Выбрано: ${selectedEntities().length}` : selectionStatusText();
}

async function runSelectionAction(action) {
  if (!canApplySelectionAction(action)) {
    statusChip.textContent = selectionActionStatus(action);
    draw();
    return;
  }
  closeSelectionActionPicker({ updateStatus: false });
  if (action === "scale-selection") await scaleSelection();
  else applySelectionAction(action);
  draw();
}

function startSelectionAction(action) {
  if (state.actionPicking === action) {
    closeSelectionActionPicker();
    draw();
    return;
  }
  if (canApplySelectionAction(action)) {
    void runSelectionAction(action);
    return;
  }
  closeCopyTools();
  hideDrawToolMenu();
  hideDimensionToolMenu();
  hideAnnotationToolMenu();
  hideSelectModeMenu();
  hideSelectToolMenu();
  state.actionPicking = action;
  state.selectTool = "multi";
  statusChip.textContent = selectionActionStatus(action);
  draw();
}

bindPointAction(quickMoveTool, () => startSelectionAction("move"));
bindPointAction(quickScaleTool, () => startSelectionAction("scale-selection"));
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
  startMoveLikeCommand(selected, "copy");
  state.moveCommand.copyMode = mode;
  copyToolMenu.hidden = false;
}

bindPointAction(quickCopyTool, () => {
  if (state.actionPicking) closeSelectionActionPicker({ updateStatus: false });
  if (!copyToolMenu.hidden || state.copyPicking || state.moveCommand?.mode === "copy") {
    closeCopyTools();
  } else {
    hideDrawToolMenu();
    hideDimensionToolMenu();
    hideAnnotationToolMenu();
    hideSelectModeMenu();
    hideSelectToolMenu();
    if (selectedEntities().length) startCopyPlacement("repeat");
    else {
      state.copyPicking = "repeat";
      state.selectTool = "multi";
      statusChip.textContent = "Выберите один или несколько объектов и нажмите ✓";
    }
    copyToolMenu.hidden = false;
  }
  draw();
});
copyToolMenu.addEventListener("click", event => {
  const mode = event.target.closest("[data-copy-mode]")?.dataset.copyMode;
  if (!mode) return;
  if (!selectedEntities().length) {
    state.copyPicking = mode;
    state.selectTool = "multi";
    statusChip.textContent = "Тираж · выберите объекты и нажмите ✓";
    draw();
  } else {
    startCopyPlacement(mode);
  }
});
bindPointAction(copyClose, () => {
  if (state.actionPicking) {
    closeSelectionActionPicker();
    draw();
    return;
  }
  closeCopyTools();
  statusChip.textContent = selectionStatusText();
  draw();
});
bindPointAction(copyConfirm, () => {
  if (state.actionPicking) void runSelectionAction(state.actionPicking);
  else if (state.copyPicking) startCopyPlacement(state.copyPicking);
  else {
    closeCopyTools();
    statusChip.textContent = "Копирование завершено";
    draw();
  }
});
copyCount.addEventListener("input", draw);
bindPointAction(quickRotateTool, () => startSelectionAction("rotate"));
bindPointAction(quickDeleteTool, () => startSelectionAction("delete"));
for (const button of quickEditButtons) {
  bindPointAction(button, () => {
    const mode = button.dataset.quickEdit;
    if (state.lineEdit?.mode !== mode) startQuickEdit(mode);
    else if (boundaryEditModes.has(mode) && !state.lineEdit.quick) startQuickEdit(mode);
    else if (state.lineEdit.pending || !state.lineEdit.applied) lineUi.lineEditCancel.click();
    else endLineEdit("Правка завершена");
  });
}

function bindMetricField(input) {
  const field = input.parentElement;
  let press = null;
  let suppressClick = false;
  field.addEventListener("pointerdown", (event) => {
    if (!event.isPrimary || event.button !== 0 || document.activeElement === input || event.target.closest(".numeric-stepper")) return;
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
      if (state.numericEdit?.figureMetric) cancelFigureMetricInput();
      else if (lineMetricContext()) closeLineMetricInput();
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

function beginCircleRadiusEdit(input) {
  if (input !== lengthInput || state.drawing) return;
  const circle = selectedCircleForMetrics();
  if (!circle || state.circleRadiusEdit?.entityId === circle.id) return;
  state.selectedFigureGrip = null;
  state.circleRadiusEdit = { entityId: circle.id, before: entityGeometry(circle) };
}

function beginMetricStep(input) {
  steppedMetricInput = lastNumericInput = input;
  beginCircleRadiusEdit(input);
  beginNumericInputEdit(input);
  const active = document.activeElement;
  if (active !== input && keyboardInputs.includes(active)) active.blur();
  keyboardConfirmButton.hidden = false;
}

keyboardInputs.forEach((input) => {
  bindMetricField(input);
  if (cornerMetrics.contains(input)) addNumericStepper(input, {
    getStep: () => state.numericStep,
    limits: () => {
      const figure = figureMetricContext(input);
      const width = figure?.type === "rectangle" || Boolean(selectedRectangleForMetrics());
      const angle = lineMetricKinds.get(input) === "angle" && !width;
      if (figure?.type === "bend") {
        if (angle) return { min: 0.001, max: 359.999 };
        const half = toProjectLength(distanceWorld(figure.start, figure.arcEnd) / 2, state.measurementSettings);
        return { min: half, initial: half };
      }
      return angle ? {} : { min: 0 };
    },
    beforeChange: () => beginMetricStep(input),
    onHold: (held) => {
      if (held) pressedMetricFields.add(input.parentElement);
      else {
        pressedMetricFields.delete(input.parentElement);
        draw();
      }
    },
  });
  input.addEventListener("focus", () => {
    steppedMetricInput = null;
    beginCircleRadiusEdit(input);
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
    if (!steppedMetricInput && !keyboardInputs.includes(event.relatedTarget) && event.relatedTarget !== keyboardConfirmButton &&
        !linePointAssist.contains(event.relatedTarget)) {
      state.circleRadiusEdit = null;
        draw();
    }
    window.setTimeout(updateViewportLock, 80);
  });
});

const currentNumericStep = () => state.numericStep;
for (const id of ["lineEditRadius", "planAnnotationHeight", "planAnnotationTextHeight"]) {
  addNumericStepper(document.getElementById(id), { getStep: currentNumericStep });
}
addNumericStepper(lineUi.lineLengthInput, {
  getStep: currentNumericStep,
  limits: () => ({ min: 0 }),
});
addNumericStepper(leaderUi.height, { getStep: currentNumericStep, limits: () => ({ min: 1, max: 100000 }) });
addNumericStepper(copyCount, { getStep: () => Math.max(1, state.numericStep) });

homeThemeButton.addEventListener("click", () => {
  homeTheme = shell.dataset.theme === "dark" ? "light" : "dark";
  try { localStorage.setItem(homeThemeKey, JSON.stringify(homeTheme)); } catch { /* optional preference */ }
  syncInterfaceTheme();
});

themeButton.addEventListener("click", () => {
  state.theme = state.theme === "light" ? "dark" : "light";
  syncInterfaceTheme();
  draw();
  markProjectDirty("theme");
});

const projectSettingsForm = projectSettingsSheet.querySelector("form");
const projectLengthUnit = projectSettingsSheet.querySelector("#projectLengthUnit");
const projectPrintScale = projectSettingsSheet.querySelector("#projectPrintScale");
const projectTotalArea = projectSettingsSheet.querySelector("#projectTotalArea");
const projectTapZoom = projectSettingsSheet.querySelector("#projectTapZoom");
const projectSpenModeChoices = [...projectSettingsSheet.querySelectorAll('input[name="spenInputMode"]')];
const projectSpenFields = {
  hoverCursor: projectSettingsSheet.querySelector("#projectSpenHover"),
  sideButton: projectSettingsSheet.querySelector("#projectSpenButton"),
  palmRejection: projectSettingsSheet.querySelector("#projectSpenPalm"),
  compactUi: projectSettingsSheet.querySelector("#projectSpenCompact"),
};

for (const [mode, appearance] of Object.entries(spenInputModes)) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "spen-mode-choice";
  button.dataset.inputMode = mode;
  button.setAttribute("aria-pressed", "false");
  button.innerHTML = `${cadIcon(appearance.icon)}<span><strong>${appearance.label}</strong><small>${appearance.description}</small></span>`;
  button.addEventListener("click", () => {
    cancelPendingCanvasTap();
    tapZoom = null;
    if (!state.activePointers.size) state.pointer = null;
    spenSettings = normalizeSpenSettings({ ...spenSettings, mode });
    saveSpenSettings();
    syncSpenMode({ announce: true });
    spenModeSheet.close();
  });
  document.getElementById("spenModeChoices").append(button);
}
spenIndicator.addEventListener("click", () => {
  syncSpenMode();
  spenModeSheet.showModal();
  spenIndicator.setAttribute("aria-expanded", "true");
  spenModeSheet.querySelector('[aria-pressed="true"]')?.focus({ preventScroll: true });
});
document.getElementById("closeSpenMode").addEventListener("click", () => spenModeSheet.close());
spenModeSheet.addEventListener("click", (event) => {
  if (event.target === spenModeSheet) spenModeSheet.close();
});
spenModeSheet.addEventListener("close", () => {
  spenIndicator.setAttribute("aria-expanded", "false");
  spenIndicator.focus({ preventScroll: true });
});
const projectPrecisionFields = {
  precision: projectSettingsSheet.querySelector("#projectLengthPrecision"),
  anglePrecision: projectSettingsSheet.querySelector("#projectAnglePrecision"),
  areaPrecision: projectSettingsSheet.querySelector("#projectAreaPrecision"),
};

for (const preset of ANNOTATION_SCALE_PRESETS) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "annotation-scale-card";
  button.dataset.annotationScale = String(preset.factor);
  button.setAttribute("role", "radio");
  button.setAttribute("aria-checked", "false");
  const scale = document.createElement("strong");
  scale.textContent = `1:${preset.denominator}`;
  button.append(scale);
  annotationScaleGrid.append(button);
}

annotationScaleButton.addEventListener("click", () => {
  syncAnnotationScaleChoice(annotationScaleSelect.value);
  annotationScaleSheet.showModal();
  annotationScaleGrid.querySelector('[aria-checked="true"]')?.focus({ preventScroll: true });
});
annotationScaleGrid.addEventListener("click", (event) => {
  const button = event.target.closest("[data-annotation-scale]");
  if (!button) return;
  syncAnnotationScaleChoice(button.dataset.annotationScale);
  annotationScaleSheet.close();
});
annotationScaleSheet.querySelector("#closeAnnotationScale").addEventListener("click", () => annotationScaleSheet.close());
annotationScaleSheet.addEventListener("click", (event) => {
  if (event.target === annotationScaleSheet) annotationScaleSheet.close();
});
annotationScaleSheet.addEventListener("close", () => annotationScaleButton.focus({ preventScroll: true }));

for (const [name, field] of Object.entries(projectPrecisionFields)) {
  const maximum = name === "anglePrecision" ? 3 : 4;
  for (let digits = 0; digits <= maximum; digits++) field.add(new Option(String(digits), String(digits)));
}

function projectSettingsDraft() {
  return normalizeMeasurementSettings({
    unit: projectLengthUnit.value,
    printScale: projectPrintScale.value,
    ...Object.fromEntries(Object.entries(projectPrecisionFields).map(([name, field]) => [name, field.value])),
  });
}

function syncProjectTotalArea(settings = state.measurementSettings) {
  projectTotalArea.textContent = formatProjectArea(totalPlanAreaM2(state.entities), settings);
}

function syncSpenSettingsForm() {
  const mode = projectSpenModeChoices.find(field => field.checked)?.value || "auto";
  for (const field of Object.values(projectSpenFields)) field.disabled = mode === "finger";
  document.getElementById("projectSpenModeHelp").textContent = spenInputModes[mode].description;
}

projectSettingsButton.addEventListener("click", () => {
  if (!persistence.projectId || projectSettingsSheet.open) return;
  hideSheet(layersSheet, { restoreFocus: false });
  hideSheet(exportSheet, { restoreFocus: false });
  const settings = state.measurementSettings;
  syncAnnotationScaleChoice(state.annotationScale);
  projectLengthUnit.value = settings.unit;
  projectPrintScale.value = settings.printScale;
  projectTapZoom.checked = state.tapZoomEnabled;
  for (const field of projectSpenModeChoices) field.checked = field.value === spenSettings.mode;
  for (const [name, field] of Object.entries(projectSpenFields)) field.checked = spenSettings[name];
  syncSpenSettingsForm();
  for (const [name, field] of Object.entries(projectPrecisionFields)) field.value = String(settings[name]);
  syncProjectTotalArea(settings);
  projectSettingsSheet.showModal();
});
projectSettingsSheet.querySelector("#closeProjectSettings").addEventListener("click", () => projectSettingsSheet.close());
projectSettingsForm.addEventListener("input", () => {
  syncProjectTotalArea(projectSettingsDraft());
  syncSpenSettingsForm();
});
projectSettingsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  state.measurementSettings = projectSettingsDraft();
  state.tapZoomEnabled = projectTapZoom.checked;
  spenSettings = normalizeSpenSettings({ mode: projectSpenModeChoices.find(field => field.checked)?.value || "auto",
    ...Object.fromEntries(Object.entries(projectSpenFields).map(([name, field]) => [name, field.checked])) });
  saveSpenSettings();
  syncSpenMode();
  if (!state.tapZoomEnabled) {
    cancelPendingCanvasTap();
    tapZoom = null;
  }
  exportScale.value = state.measurementSettings.printScale;
  setAnnotationScale(annotationScaleSelect.value, { save: false });
  markProjectDirty("project-settings");
  projectSettingsSheet.close();
  statusChip.textContent = "Настройки проекта применены";
});


document.getElementById("undoButton").addEventListener("click", () => {
  if (undoCircleConstruction() || undoLineSegment()) return;
  if (state.tool === "revision-cloud" && state.drawing) {
    if (state.drawing.points.length === 1) state.drawing = null;
    else state.drawing.points.pop();
    statusChip.textContent = revisionCloudPrompt();
    draw();
    return;
  }
  if (state.planZone?.points.length) {
    state.planZone.points.pop();
    statusChip.textContent = "Точка снята. Укажите следующую точку контура";
    draw();
    return;
  }
  const action = state.undo.at(-1);
  if (!action || !canApplyLayerHistory(action, "before")) return;
  state.undo.pop();
  if (state.lineEdit) endLineEdit("Правка отменена");
  if (action.type === "line-edit") {
    state.redo.push(action);
    restoreLineEdit(action.after, action.before);
  } else if (action.type === "block-library") {
    state.redo.push(action);
    applyBlockLibrary(action.before);
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
  } else if (action.type === "entity-batch") {
    state.redo.push(action);
    applyEntityBatch(action, "before");
  } else if (action.type === "annotation-batch") {
    state.redo.push(action);
    applyAnnotationBatch(action.edits, "before");
  } else if (action.type === "layer-assign") {
    state.redo.push(action);
    applyLayerAssignments(action, "before");
  } else if (action.type === "layer-remove") {
    state.redo.push(action);
    applyLayerRemoval(action, false);
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
  const action = state.redo.at(-1);
  if (!action || !canApplyLayerHistory(action, "after")) return;
  state.redo.pop();
  if (action.type === "line-edit") {
    state.undo.push(action);
    restoreLineEdit(action.before, action.after);
  } else if (action.type === "block-library") {
    state.undo.push(action);
    applyBlockLibrary(action.after);
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
  } else if (action.type === "entity-batch") {
    state.undo.push(action);
    applyEntityBatch(action, "after");
  } else if (action.type === "annotation-batch") {
    state.undo.push(action);
    applyAnnotationBatch(action.edits, "after");
  } else if (action.type === "layer-assign") {
    state.undo.push(action);
    applyLayerAssignments(action, "after");
  } else if (action.type === "layer-remove") {
    state.undo.push(action);
    applyLayerRemoval(action, true);
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
const exportFormats = document.getElementById("exportFormats");
const exportPdfSettings = document.getElementById("exportPdfSettings");
const exportSheetTitle = document.getElementById("exportSheetTitle");
const confirmPdfExport = document.getElementById("confirmPdfExport");
let pdfExportType = null;

function showExportStage(type = null) {
  pdfExportType = type;
  exportFormats.hidden = Boolean(type);
  exportPdfSettings.hidden = !type;
  exportSheetTitle.textContent = type === "zip" ? "Настройки PDF в комплекте" : type ? "Настройки PDF" : "Файлы чертежа";
  confirmPdfExport.textContent = type === "zip" ? "Сохранить ZIP" : "Сохранить PDF";
  if (type) exportScale.focus({ preventScroll: true });
}
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
  const all = entities.concat(details.entities || []).filter((entity) => entity.layer !== TRACE_LAYER);
  if (exportScope.value === "all") return all;
  const isVisible = (entity) => visibleLayers.has(entity.layer || DEFAULT_LINE_LAYER);
  return all.filter(isVisible).flatMap((entity) => {
    if (!isReusableBlock(entity)) return [entity];
    const parts = entity.parts.filter(isVisible);
    return parts.length ? [{ ...entity, parts }] : [];
  });
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
  const includesDraft = vertexCount >= 2 && draftLayer !== TRACE_LAYER && (exportScope.value === "all" || state.visibleLayers.has(draftLayer));
  if (includesDraft) layers.add(draftLayer);
  const planObjects = [...state.entities, ...details.entities].filter((entity) => entity.layer !== TRACE_LAYER);
  const skipped = planObjects.length - entities.length;
  const hiddenLayers = new Set(planObjects.map((entity) => entity.layer || "measure")
    .filter((layer) => !state.visibleLayers.has(layer)));
  const hidesDraft = vertexCount >= 2 && draftLayer !== TRACE_LAYER && !state.visibleLayers.has(draftLayer);
  if (hidesDraft) hiddenLayers.add(draftLayer);
  const layerNames = (ids) => [...ids].map((id) => drawingLayerInfo(id)?.name || id).join(", ");
  const draftMessage = vertexCount >= 2 ? ` Полилиния из ${vertexCount} вершин будет завершена.` : "";
  const dimensionWarning = dimensionExportWarning(entities);
  const hiddenMessage = exportScope.value === "visible" && hiddenLayers.size ? ` Скрыто объектов: ${skipped + Number(hidesDraft)}. Слои: ${layerNames(hiddenLayers)}.` : "";
  const traceMessage = planObjects.length < state.entities.length + details.entities.length || (vertexCount >= 2 && draftLayer === TRACE_LAYER)
    ? " Калька входит только в копию .zamer." : "";
  exportSummary.textContent = `План: ${entities.length + Number(includesDraft)} объектов.`
    + (layers.size ? ` Слои: ${layerNames(layers)}.` : "") + hiddenMessage + draftMessage + " В копии .zamer сохраняются все слои." + traceMessage
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
    showExportStage();
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

function renderExportPlan(context, view, entities, scaleFactor, measurementSettings, customLineLayers, layerStyles) {
  const editorContext = ctx;
  const editorView = state.view;
  const editorTheme = state.theme;
  const editorAnnotationScale = state.annotationScale;
  const editorMeasurementSettings = state.measurementSettings;
  const palette = { bg: "#ffffff", wall: "#203245", line: "#203245", dimension: "#183d72", accent: "#183d72", surface: "#ffffff", revisionCloud: "#b62e3b" };
  // Only the synchronous paint uses the print camera. Browser events and
  // attachment decoding run after the editor context has been restored.
  ctx = context;
  state.view = view;
  state.theme = "light";
  state.annotationScale = annotationScaleFactor(scaleFactor);
  state.measurementSettings = measurementSettings;
  printRendering = true;
  try {
    drawPlanScene(entities, palette, customLineLayers, layerStyles);
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
  for (const button of [...exportCards, confirmPdfExport]) button.disabled = true;
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
    const pdf = () => buildPlotPdf(project, expandDrawingBlocks(entities), details, {
      scale: exportScale.value, photos: exportPhotos.checked,
      layerLabel: exportScope.value === "all" ? "все слои" : "видимые слои",
    }, (...args) => renderExportPlan(...args, project.customLineLayers ?? [], project.layerStyles ?? {}));
    const dxf = (revit = false, forDwg = false) => {
      const includeReadings = exportScope.value === "all" || project.visibleLayers.includes("dimensions");
      let drawing = includeReadings ? entities.concat(surveyDxfLegend(entities, details.records)) : entities;
      if (!drawing.length) throw new Error("На выбранных слоях нет объектов для DXF. Попробуйте выбрать все слои.");
      if (forDwg) drawing = drawing.map(entity => entity.type === "rectangle"
        ? { ...entity, type: "polyline", closed: true, points: rectangleCorners(entity) } : entity);
      const options = { annotationScale: project.annotationScale, measurementSettings: project.measurementSettings,
        customLineLayers: project.customLineLayers, lockedLayers: project.lockedLayers, layerStyles: project.layerStyles };
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
    } else if (type === "dwg") {
      const cad = dxf(false, true);
      const { dxfToDwg } = await import("./core/dwg.js");
      file = await downloadFile(`${planName}-${stamp}.dwg`, await dxfToDwg(cad), "application/acad");
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
    for (const button of [...exportCards, confirmPdfExport]) button.disabled = false;
  }
}

for (const button of exportCards) {
  button.addEventListener("click", () => {
    const { export: type } = button.dataset;
    if (type === "pdf" || type === "zip") {
      setExportResult("");
      exportFileActions.hidden = true;
      showExportStage(type);
    } else void exportCurrentProject(type);
  });
}

confirmPdfExport.addEventListener("click", () => {
  if (pdfExportType) void exportCurrentProject(pdfExportType);
});
document.getElementById("backExportFormats").addEventListener("click", () => {
  const card = exportCards.find(button => button.dataset.export === pdfExportType);
  showExportStage();
  card?.focus({ preventScroll: true });
});

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
  const scrollTop = layerList.scrollTop;
  const rows = document.createDocumentFragment();
  const layers = [...Object.entries(layerMeta), ...state.customLineLayers.map((layer) => [layer.id, layer])];
  for (const [id] of layers) {
    const { name, color } = drawingLayerInfo(id);
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
    const description = document.createElement("small");
    description.className = "layer-style-summary";
    description.textContent = `${lineTypeLabel(drawingLayerInfo(id).lineType)} · ${lineWeightLabel(normalizeLineWeight(drawingLayerInfo(id).lineWeight) ?? DEFAULT_LINE_WEIGHT)}`;
    const labels = document.createElement("span");
    labels.className = "layer-labels";
    labels.append(caption);
    if (selectable) labels.append(description);
    title.append(swatch, labels);

    const visibility = document.createElement("label");
    visibility.className = "layer-visibility";
    const input = document.createElement("input");
    input.className = "layer-toggle";
    input.type = "checkbox";
    input.setAttribute("aria-label", `Видимость слоя ${name}`);
    input.addEventListener("change", () => setLayerVisibility(id, input.checked));
    visibility.append(input);
    const menu = document.createElement("button");
    menu.className = "layer-menu";
    menu.type = "button";
    menu.setAttribute("aria-haspopup", "dialog");
    menu.setAttribute("aria-controls", layerActionsDialog.id);
    menu.addEventListener("click", () => showLayerActions(id));
    item.append(title, visibility, menu);
    rows.append(item);
  }
  layerList.replaceChildren(rows);
  layerList.scrollTop = scrollTop;
  addLineLayerButton.disabled = state.customLineLayers.length >= MAX_CUSTOM_LINE_LAYERS;
  syncLayerControls();
}

function syncLayerControls() {
  for (const row of layerList.children) {
    const id = row.dataset.layer;
    const locked = isLayerLocked(id);
    row.querySelector("input").checked = state.visibleLayers.has(id);
    const title = row.querySelector("button[data-line-layer]");
    if (title) {
      title.disabled = locked;
      title.setAttribute("aria-pressed", String(state.activeLineLayer === id && !locked));
    }
    const menu = row.querySelector(".layer-menu");
    const label = `Действия слоя «${drawingLayerInfo(id).name}»${locked ? " · заблокирован" : ""}`;
    menu.dataset.locked = String(locked);
    menu.setAttribute("aria-label", label);
    menu.title = label;
    menu.innerHTML = cadIcon(locked ? "lock" : "more");
  }
  const active = drawingLayerInfo(state.activeLineLayer);
  const activeLocked = !active || isLayerLocked(state.activeLineLayer);
  activeLayerStyle?.style.setProperty("--active-layer-color", active?.color || "currentColor");
  for (const button of activeLayerStyle?.querySelectorAll("[data-active-layer-action]") || []) {
    button.disabled = activeLocked;
    const action = { color: "Цвет", weight: "Вес линии", type: "Тип линии" }[button.dataset.activeLayerAction];
    const label = `${action} · ${active?.name || "активный слой"}`;
    button.title = label;
    button.setAttribute("aria-label", label);
  }
}

function resetActiveLineLayer() {
  const ids = availableLineLayerIds();
  state.activeLineLayer = ids.find((id) => state.visibleLayers.has(id)) ?? ids[0] ?? DEFAULT_LINE_LAYER;
}

function revealActiveLineLayer() {
  if (state.traceEditing) return TRACE_LAYER;
  if (isLayerLocked(state.activeLineLayer)) resetActiveLineLayer();
  const id = state.activeLineLayer;
  if (isLayerLocked(id)) return null;
  state.visibleLayers.add(id);
  return id;
}

function activateLineLayer(id) {
  if (isLayerLocked(id)) return;
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
    if (state.activeLineLayer === id) resetActiveLineLayer();
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

function layerNameError(value, except) {
  if (!normalizeLineLayerName(value)) return "Введите допустимое название слоя";
  const ids = [...Object.keys(layerMeta), ...state.customLineLayers.map(({ id }) => id)];
  return ids.some((id) => id !== except && drawingLayerInfo(id).name.toLocaleLowerCase("ru") === value.toLocaleLowerCase("ru"))
    ? "Слой с таким названием уже есть" : null;
}

function layerInUse(id) {
  const usesLayer = (entity) => entity.layer === id || (Array.isArray(entity.parts) && entity.parts.some((part) => part.layer === id));
  return state.entities.some(usesLayer) || state.drawing?.layer === id || state.reusableBlocks?.some(usesLayer) ||
    state.survey.rooms.some((room) => room.drawing?.draft?.layer === id || room.drawing?.entities?.some(usesLayer));
}

function canApplyLayerHistory(action, snapshot) {
  const layers = new Set();
  const recordEntity = (entity) => {
    if (!entity) return;
    layers.add(entity.layer || DEFAULT_LINE_LAYER);
  };
  const recordEdit = ({ entityId, before, after }) => {
    recordEntity(state.entities.find(({ id }) => id === entityId));
    for (const item of [before, after]) if (item && Object.hasOwn(item, "layer")) recordEntity(item);
  };

  switch (action.type) {
    case "layer-remove":
      if (snapshot === "after" && layerInUse(action.layer.id)) {
        statusChip.textContent = "Можно удалить только пустой слой";
        return false;
      }
      if (snapshot === "before" && state.customLineLayers.length >= MAX_CUSTOM_LINE_LAYERS) {
        statusChip.textContent = "Достигнут предел числа слоёв";
        return false;
      }
      layers.add(action.layer.id);
      break;
    case "layer-assign":
      for (const { before, after } of action.items) {
        layers.add(before || DEFAULT_LINE_LAYER);
        layers.add(after);
      }
      break;
    case "line-edit":
      for (const { entity } of [...action.before, ...action.after]) recordEntity(entity);
      break;
    case "delete-many":
      for (const { entity } of action.items) recordEntity(entity);
      break;
    case "move-selection":
    case "annotation-batch":
      for (const edit of action.edits) recordEdit(edit);
      break;
    case "move":
      recordEdit(action);
      break;
    case "add":
    case "delete":
      recordEntity(action.entity);
      break;
  }
  const locked = [...layers].find(isLayerLocked);
  if (locked) statusChip.textContent = layerLockMessage(locked);
  return !locked;
}

function assignableLayerSelection() {
  const selected = selectedEntities();
  return selected.length && selected.every((entity) => canAssignEntityToLineLayer(entity) && !isLayerLocked(entity.layer)) ? selected : [];
}

function setLayerLocked(id, locked) {
  if (locked) {
    state.lockedLayers.push(id);
    const currentLayer = state.drawing?.layer ?? annotationLayerForTool(state.tool) ?? state.activeLineLayer;
    const pendingTextLayer = state.leaderInput && (state.leaderInput.entity?.layer || "text");
    const pointerTarget = state.entities.find((entity) => entity.id === state.pointer?.targetId);
    if ((state.drawing && currentLayer === id) || pendingTextLayer === id || pointerTarget?.layer === id ||
        state.moveCommand || state.offsetCommand || state.lineEdit || state.dimensionAttach || state.copyPicking || state.actionPicking) {
      if (state.drawing && currentLayer === id) state.drawing = null;
      activatePlainSelect();
    }
    const circle = state.entities.find((entity) => entity.id === state.circleRadiusEdit?.entityId);
    if (circle && isLayerLocked(circle.layer)) hideInlineEditors();
    if (state.activeLineLayer === id) resetActiveLineLayer();
    setSelection(selectedEntities().filter((entity) => !isLayerLocked(entity.layer)).map(({ id }) => id));
  } else {
    state.lockedLayers = state.lockedLayers.filter((layer) => layer !== id);
    updateLinkedDimensions();
  }
  syncLayerControls();
  markProjectDirty("layer-lock");
  statusChip.textContent = locked ? layerLockMessage(id) : `Слой «${drawingLayerInfo(id).name}» разблокирован`;
  draw();
}

function applyLayerAssignments(action, snapshot) {
  for (const item of action.items) {
    const entity = state.entities.find(({ id }) => id === item.entityId);
    if (!entity) continue;
    if (item[snapshot] === undefined) delete entity.layer;
    else entity.layer = item[snapshot];
  }
  if (snapshot === "after") state.visibleLayers.add(action.destination);
  setSelection(action.items.map(({ entityId }) => entityId));
  syncLayerControls();
  markProjectDirty("layer-assignment");
  draw();
}

function assignSelectionToLayer(destination) {
  const items = assignableLayerSelection().filter((entity) => (entity.layer || DEFAULT_LINE_LAYER) !== destination)
    .map((entity) => ({ entityId: entity.id, before: entity.layer, after: destination }));
  if (!items.length || !availableLineLayerIds().includes(destination)) return;
  const action = { type: "layer-assign", items, destination };
  state.undo.push(action);
  state.redo.length = 0;
  applyLayerAssignments(action, "after");
  statusChip.textContent = `Перенесено на слой «${drawingLayerInfo(destination).name}»: ${items.length}`;
}

function applyLayerRemoval(action, remove) {
  const { layer, index, wasVisible, wasActive, style } = action;
  if (remove) {
    state.customLineLayers = state.customLineLayers.filter(({ id }) => id !== layer.id);
    delete state.layerStyles[layer.id];
    state.visibleLayers.delete(layer.id);
    if (state.activeLineLayer === layer.id) resetActiveLineLayer();
  } else {
    state.customLineLayers.splice(index, 0, layer);
    if (style) state.layerStyles[layer.id] = style;
    if (wasVisible) state.visibleLayers.add(layer.id);
    if (wasActive) state.activeLineLayer = layer.id;
  }
  renderLayerList();
  markProjectDirty("layer-remove");
  statusChip.textContent = remove ? `Слой «${layer.name}» удалён` : `Слой «${layer.name}» восстановлен`;
  draw();
}

function showLayerActions(id) {
  const layer = drawingLayerInfo(id);
  if (!layer || layerActionsDialog.open) return;
  const custom = !Object.hasOwn(layerMeta, id);
  const lineLayer = id === DEFAULT_LINE_LAYER || custom;
  const locked = isLayerLocked(id);
  const actions = [[locked ? "unlock" : "lock", locked ? "Разблокировать" : "Заблокировать", false]];
  if (custom && !locked) actions.push(["edit", "Переименовать", false]);
  if (!locked) actions.push(["color", "Изменить цвет", false]);
  if (lineLayer && !locked) actions.push(["weight", "Вес линии", false]);
  if (lineLayer && !locked) actions.push(["type", "Тип линии", false]);
  if (availableLineLayerIds().includes(id) && assignableLayerSelection().some((entity) => (entity.layer || DEFAULT_LINE_LAYER) !== id)) {
    actions.push(["move", "Перенести выбранное сюда", false]);
  }
  if (custom && !locked) actions.push(["delete", "Удалить слой", layerInUse(id)]);
  layerActionsDialog.dataset.layer = id;
  layerActionsDialog.querySelector("h2").textContent = layer.name;
  layerActionsList.replaceChildren(...actions.map(([action, label, disabled]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = action === "delete" ? "project-menu-item danger" : "project-menu-item";
    button.dataset.layerAction = action;
    button.disabled = disabled;
    if (disabled) button.title = "Можно удалить только пустой слой";
    button.innerHTML = `${cadIcon(action)}<span>${label}</span>`;
    return button;
  }));
  layerActionsDialog.showModal();
  layerActionsList.querySelector("button")?.focus({ preventScroll: true });
}

layerActionsDialog.querySelector("header button").addEventListener("click", () => layerActionsDialog.close());
layerActionsList.addEventListener("click", async (event) => {
  const action = event.target.closest("[data-layer-action]")?.dataset.layerAction;
  const id = layerActionsDialog.dataset.layer;
  const layer = drawingLayerInfo(id);
  if (!action || !layer) return;
  layerActionsDialog.close();
  if (action === "lock" || action === "unlock") {
    setLayerLocked(id, action === "lock");
  } else if (action === "move") {
    assignSelectionToLayer(id);
  } else if (action === "delete" && !isLayerLocked(id) && !layerInUse(id)) {
    const storedLayer = state.customLineLayers.find((item) => item.id === id);
    const index = state.customLineLayers.indexOf(storedLayer);
    if (index < 0) return;
    const change = { type: "layer-remove", index, layer: storedLayer, style: state.layerStyles[id],
      wasVisible: state.visibleLayers.has(id), wasActive: state.activeLineLayer === id };
    state.undo.push(change);
    state.redo.length = 0;
    applyLayerRemoval(change, true);
    addLineLayerButton.focus({ preventScroll: true });
  } else if (action === "weight") {
    const identity = projectIdentity();
    const current = normalizeLineWeight(layer.lineWeight) ?? DEFAULT_LINE_WEIGHT;
    const value = await showProjectDialog({
      title: "Вес линий слоя",
      inputLabel: "Вес линии",
      value: String(current),
      choices: LINE_WEIGHT_VALUES.map((weight) => ({ value: String(weight), label: lineWeightLabel(weight) })),
    });
    const normalized = normalizeLineWeight(value);
    if (normalized === null || !isActiveProject(identity) || isLayerLocked(id) || normalized === current) return;
    setLayerStyle(id, { lineWeight: normalized });
    renderLayerList();
    markProjectDirty("layer-style");
    draw();
  } else if (action === "type") {
    const identity = projectIdentity();
    const current = normalizeLineType(layer.lineType) || DEFAULT_LINE_TYPE;
    const value = await showProjectDialog({
      title: "Тип линий слоя",
      inputLabel: "Тип линии",
      value: current,
      choices: LINE_TYPE_VALUES.map((type) => ({ value: type, label: lineTypeLabel(type) })),
    });
    const normalized = normalizeLineType(value);
    if (!normalized || !isActiveProject(identity) || isLayerLocked(id) || normalized === current) return;
    setLayerStyle(id, { lineType: normalized });
    renderLayerList();
    markProjectDirty("layer-style");
    draw();
  } else if (action === "edit" || action === "color") {
    const identity = projectIdentity();
    const rename = action === "edit";
    const value = await showProjectDialog(rename
      ? { title: "Переименовать слой", inputLabel: "Название слоя", value: layer.name,
          maxLength: MAX_LINE_LAYER_NAME_LENGTH, validateValue: (name) => layerNameError(name, id) }
      : { title: "Цвет слоя", inputLabel: "Цвет слоя", inputType: "color", value: layer.color });
    const normalized = rename ? normalizeLineLayerName(value) : normalizeLineLayerColor(value);
    const storedLayer = state.customLineLayers.find((item) => item.id === id);
    if (!normalized || !isActiveProject(identity) || isLayerLocked(id) || layer[rename ? "name" : "color"] === normalized ||
        (rename && !storedLayer)) return;
    if (rename) storedLayer.name = normalized;
    else setLayerStyle(id, { color: normalized });
    renderLayerList();
    [...layerList.children].find((row) => row.dataset.layer === id)?.querySelector(".layer-menu").focus({ preventScroll: true });
    markProjectDirty("layer-style");
    draw();
  }
});

activeLayerStyle?.addEventListener("click", (event) => {
  const action = event.target.closest("[data-active-layer-action]")?.dataset.activeLayerAction;
  const id = state.activeLineLayer;
  if (!action || !drawingLayerInfo(id) || isLayerLocked(id)) return;
  showLayerActions(id);
  const actionButton = layerActionsList.querySelector(`[data-layer-action="${action}"]`);
  if (actionButton) actionButton.click();
  else if (layerActionsDialog.open) layerActionsDialog.close();
});

async function addLineLayer() {
  if (!persistence.ready || state.customLineLayers.length >= MAX_CUSTOM_LINE_LAYERS) return;
  const identity = projectIdentity();
  const name = await showProjectDialog({
    title: "Новый слой",
    inputLabel: "Название слоя",
    placeholder: "Название слоя",
    confirmText: "Создать",
    maxLength: MAX_LINE_LAYER_NAME_LENGTH,
    validateValue: (value) => layerNameError(value),
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
  if (state.traceEditing || state.tool !== "polyline" || !state.drawing?.points?.length) return undefined;
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
  if (tool === "text" || (tool === "revision-cloud" && !state.traceEditing) ||
      (tool === "dimension" && state.dimensionTool === "leader")) return "text";
  return tool === "dimension" ? "dimensions" : null;
}

function planZoneName(type = state.tool) {
  return type === "area" ? "Площадь" : "Высота Z";
}

function planContourClosesAtCursor(points) {
  const point = state.pointer?.confirmedSnap?.resolved.point || rawCursorWorld();
  return points.length >= 3 && snapEnabled("end") && distanceWorld(point, points[0]) * state.view.scale <= screenUiPx(14);
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
function labelContextIcon(button, label) {
  const caption = document.createElement("small");
  caption.className = "context-icon-label";
  caption.setAttribute("aria-hidden", "true");
  caption.textContent = label;
  button.append(caption);
}

const planAnnotationModesAppearance = {
  contour: ["polyline", "Контур"],
  rectangle: ["rectangle", "Прямоуг."],
  existing: ["plan", "Из плана"],
};
for (const button of planAnnotationModesButtons) {
  const [icon, label] = planAnnotationModesAppearance[button.dataset.planMode];
  button.innerHTML = cadIcon(icon);
  labelContextIcon(button, label);
}
for (const [button, icon, label] of [
  [planAnnotationClose, "closeContour", "Замкнуть"],
  [planAnnotationAddContour, "addContour", "+ Контур"],
  [planAnnotationEdit, "edit", "Правка"],
]) {
  button.innerHTML = cadIcon(icon);
  labelContextIcon(button, label);
}
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
  textFrame: typeof initialAnnotationPreferences?.textFrame === "boolean" ? initialAnnotationPreferences.textFrame : false,
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
  if (kinds.includes("text")) {
    if (validAnnotationTextHeight(values.textHeight)) annotationPreferences.textHeight = values.textHeight;
    const frame = typeof values.textFrame === "boolean" ? values.textFrame : values.leaderFrame;
    if (typeof frame === "boolean") annotationPreferences.textFrame = frame;
  }
  if (kinds.includes("leader")) {
    if (validAnnotationTextHeight(values.textHeight)) annotationPreferences.leaderHeight = values.textHeight;
    if (values.leaderLine === "straight" || values.leaderLine === "bent") annotationPreferences.leaderLine = values.leaderLine;
    if (typeof values.leaderFrame === "boolean") annotationPreferences.leaderFrame = values.leaderFrame;
  }
  if (kinds.includes("elevation") && Object.hasOwn(PLAN_ELEVATION_STYLES, values.zoneStyle)) annotationPreferences.zoneStyle = values.zoneStyle;
  saveAnnotationSettings();
}

function annotationToolHeight() {
  return state.leaderInput?.options?.textHeight ?? (state.tool === "text" ? annotationPreferences.textHeight : leaderToolOptions().textHeight);
}

function syncLeaderTools() {
  const textTool = state.tool === "text" || Boolean(state.leaderInput?.point) || state.leaderInput?.entity?.type === "text";
  const active = Boolean(state.leaderInput) || (annotationToolMenu.hidden && (textTool || leaderToolActive()));
  leaderUi.tools.hidden = !active;
  if (!active) return;
  const options = leaderToolOptions();
  leaderLineButtons[0].parentElement.hidden = textTool;
  leaderUi.frame.hidden = false;
  leaderUi.tools.setAttribute("aria-label", textTool ? "Свойства текста" : "Выноска");
  leaderUi.frame.setAttribute("aria-label", textTool ? "Рамка текста" : "Рамка текста выноски");
  leaderUi.frame.title = leaderUi.frame.getAttribute("aria-label");
  const heightLabel = textTool ? "Высота текста, мм" : "Высота текста выноски, мм";
  leaderUi.height.setAttribute("aria-label", heightLabel);
  leaderUi.height.parentElement.title = heightLabel;
  const cancelLabel = textTool ? "Закрыть инструмент «Текст»" : "Отменить выноску";
  leaderUi.toolsCancel.setAttribute("aria-label", cancelLabel);
  leaderUi.toolsCancel.title = cancelLabel;
  for (const button of leaderLineButtons) {
    button.setAttribute("aria-pressed", String(button.dataset.leaderLine === options.leaderLine));
    button.disabled = Boolean(state.leaderInput && !state.leaderInput.entity);
  }
  leaderUi.frame.setAttribute("aria-pressed", String(options.leaderFrame));
  leaderUi.toolsCancel.hidden = Boolean(state.leaderInput);
  if (document.activeElement !== leaderUi.height) {
    const value = formatEditableNumber(annotationToolHeight());
    if (leaderUi.height.value !== value) leaderUi.height.value = value;
  }
}

function syncLeaderInputPosition() {
  if (!state.leaderInput) return;
  const entity = state.leaderInput.entity;
  const point = state.leaderInput.point ?? (entity?.type === "text" ? { x: entity.x, y: entity.y }
    : entity ? { x: entity.x2, y: entity.y2 } : state.drawing?.end);
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
  if (state.leaderInput?.options) Object.assign(state.leaderInput.options, values);
  else if (state.tool === "text") rememberAnnotationSettings(["text"], values);
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
  if (!valid || annotationToolHeight() === textHeight) return;
  if (state.leaderInput?.options) updateLeaderOptions({ textHeight });
  else if (state.tool === "text") {
    rememberAnnotationSettings(["text"], { textHeight });
    draw();
  } else updateLeaderOptions({ textHeight });
});
leaderUi.height.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.isComposing) return;
  event.preventDefault();
  (state.leaderInput ? leaderUi.text : canvas).focus({ preventScroll: true });
});
leaderUi.height.addEventListener("blur", () => {
  leaderUi.height.removeAttribute("aria-invalid");
  leaderUi.height.value = formatEditableNumber(annotationToolHeight());
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
  planAnnotationFields.height.placeholder = batch ? "Без изменений" : formatEditableNumber(toProjectLength(2800, settings));
  planAnnotationFields.height.value = !batch && kind === "elevation" && Number.isFinite(values.height)
    ? formatEditableNumber(toProjectLength(values.height, settings)) : "";
  planAnnotationFields.textHeight.placeholder = batch ? "Без изменений" : "";
  const defaultHeight = leader ? (values.id ? 200 : annotationPreferences.leaderHeight) : (values.id ? 260 : annotationPreferences.textHeight);
  const existingHeight = leader && values.id ? leaderTextHeight(values) : values.height;
  planAnnotationFields.textHeight.value = batch ? "" : formatEditableNumber(validAnnotationTextHeight(existingHeight) ? existingHeight : defaultHeight);
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

function planContourAt(world, { retainCurves = false } = {}) {
  const ranked = [];
  const visible = state.entities.filter((entity) => isLayerVisible(entity.layer) && traceIsReference(entity));
  for (const entity of visible) {
    const zoneGeometry = isPlanAnnotationZone(entity) ? planAnnotationGeometry(entity) : null;
    const closed = zoneGeometry?.rings || [planAnnotationGeometry({ type: "area", points: planAnnotationPointsFromEntity(entity) })];
    for (const ring of closed) {
      if (!ring) continue;
      const { points, areaMm2 } = ring;
      const distance = Math.min(...points.map((point, index) => pointToSegmentDistance(world, point, points[(index + 1) % points.length])));
      const edge = distance * state.view.scale <= screenUiPx(12);
      if (edge || pointInPolygon(world, points)) ranked.push({ points, entity, area: areaMm2, edge, distance });
    }
  }
  ranked.sort((a, b) => Number(b.edge) - Number(a.edge) || (a.edge && b.edge ? a.distance - b.distance : a.area - b.area));
  const best = ranked[0];
  if (best?.edge) return best;
  const face = planRegionAtPoint(world, visible);
  const region = planAnnotationGeometry({ type: "area", points: face });
  if (!region || region.areaMm2 >= (best?.area ?? Infinity)) return best;
  const entity = best?.entity;
  if (retainCurves && entity?.type === "polyline" && entity.bulges?.some(Boolean)) {
    const budget = Math.min(MAX_PLAN_ANNOTATION_POINTS, Math.max(64, 2 * entity.points.length));
    const sampled = planAnnotationGeometry({ type: "area", points: tessellatePolyline(entity, budget) });
    // The face finder uses a smaller arc tessellation budget than the original plan contour.
    if (sampled && Math.abs(region.areaMm2 - sampled.areaMm2) <= Math.max(.001, sampled.areaMm2 * 1e-10) &&
        Object.entries(sampled.bounds).every(([key, value]) => Math.abs(region.bounds[key] - value) <= .01)) return best;
  }
  return { points: region.points };
}

function choosePlanContour(world) {
  return planContourAt(world)?.points;
}

async function finishPlanAnnotation(points = state.planZone?.points) {
  const zone = state.planZone;
  if (!zone || planAnnotationEditor.open) return;
  const type = state.tool;
  const layer = annotationLayerForTool(type);
  if (isLayerLocked(layer)) {
    statusChip.textContent = layerLockMessage(layer);
    return;
  }
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
  if (!pushEntity(entity)) return;
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
  if (!values || projectId !== persistence.projectId || entities.some((entity) =>
    !state.entities.includes(entity) || isLayerLocked(entity.layer))) return;
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
  if (isLayerLocked(entity.layer)) return;
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
    scale: Number.isFinite(drawing?.view?.scale) ? clampScale(drawing.view.scale) : DEFAULT_VIEW_SCALE,
    panX: Number.isFinite(drawing?.view?.panX) ? drawing.view.panX : 92,
    panY: Number.isFinite(drawing?.view?.panY) ? drawing.view.panY : 84,
  };
  state.undo = [];
  state.redo = [];
  resetTrace();
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
  const point = cursorSnapResolved().point;
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
    numericStep: currentNumericStep,
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
syncInterfaceTheme();
initAuthGate().finally(() => window.ZamerAndroid?.readyForImports?.());
lockPortraitOrientation();
window.zamerDebug = {
  exportDxf: () => buildDxf(state.entities.filter((entity) => entity.layer !== TRACE_LAYER), { annotationScale: state.annotationScale, measurementSettings: state.measurementSettings,
    customLineLayers: state.customLineLayers }),
  exportRevitDxf: () => buildRevitDxf(state.entities.filter((entity) => entity.layer !== TRACE_LAYER), { annotationScale: state.annotationScale, measurementSettings: state.measurementSettings,
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
  layersButton: "layers", exportButton: "import", logoutButton: "exit", projectImportButton: "openFolder",
  quickMoveTool: "move", quickCopyTool: "copy", quickScaleTool: "scale",
  quickRotateTool: "rotate", quickDeleteTool: "delete",
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

const appUpdatesButton = document.getElementById("appUpdatesButton");
if (appUpdatesButton && window.ZamerAndroid?.showUpdates) {
  const label = document.getElementById("appUpdatesLabel");
  const status = document.getElementById("appUpdateStatus");
  window.zamerUpdateAvailable = (version) => {
    const available = typeof version === "string" && version.length > 0;
    appUpdatesButton.toggleAttribute("data-update-available", available);
    label.textContent = available ? `Обновить до ${version}` : "Обновления приложения";
    status.textContent = available ? `Доступно обновление Zamer CAD ${version}` : "";
  };
  appUpdatesButton.firstElementChild.innerHTML = cadIcon("update");
  window.zamerUpdateAvailable(window.ZamerAndroid.availableUpdateVersion?.());
  appUpdatesButton.hidden = false;
  appUpdatesButton.addEventListener("click", () => window.ZamerAndroid.showUpdates());
}

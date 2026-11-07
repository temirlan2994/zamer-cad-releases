// Лист, открытый на холсте (двойной клик в «Листах», как в Revit). Esc и
// «Закрыть лист» возвращают вид, который был открыт: режим и этаж не
// меняются, лист лишь накрывает холст.
//
// Автолисты альбома (sheetPlan() в ui/sheet.js) — картинка того же
// рендера, что и в PDF. Лист пользователя (project.sheets) — рабочий холст:
// бумага формата листа с рамкой и штампом, видовые экраны
// (ui/sheet-viewports.js). Вид кладётся перетаскиванием из дерева «Виды»
// (HTML5 DnD, тип VIEW_MIME) или кнопкой «На лист…» в «Свойствах» вида
// (касание); клик — выбрать вид, тянуть — сдвиг с шагом 5 мм (Shift —
// свободно), Delete — убрать с листа, одна запись истории на жест.
// Ручки выбранного вида (углы и середины сторон) — рамка обрезки
// (viewport.crop): край с шагом 5 мм (вблизи — 1 мм), Shift — свободно;
// вид на листе не сдвигается — двигается только край рамки.
// Двойной клик по виду — открыть сам вид (лист закрывается, Esc — назад к
// листу). Колесо — масштаб листа, средняя кнопка или пустое место — сдвиг,
// «Вписать» — весь лист; на телефоне — щипок двумя пальцами и сдвиг одним
// по пустому месту. Растр видов перерисовывается под зум ступенями ×1/×2/×4
// с задержкой 150 мс; сдвиг листа растр не перестраивает.

import {
  addSheet, cropFromPaper, cropHandlePoints, dragCropHandle, findSheetById, findViewport, moveViewport, nextSheetNo,
  normalizeCam, placeView, removeSheet, removeViewport, setViewportScale, sheetOfView, sheetSize, snapMm, updateSheet,
  viewById, viewPlacement, viewportNumbers,
} from '../core/views.js';
import { saveFile } from './cloud.js';
import { el, escapeHtml, toast } from './dom.js';
import { handleExport, safeFileName } from './files.js';
import {
  SHEET, SHEET_PX, autoSheetCount, buildOneSheetPdf, loadSheetImages, renderSheet, sheetKey, sheetList, sheetNumber, sheetTitle,
} from './sheet.js';
import {
  cachedRaster, defaultViewportScale, drawSheetDecor, dropZoomRasters, fitInFrame, freeSpot, drawViewports, prepareViewports,
  rasterReady, viewportBox, viewportRaster,
} from './sheet-viewports.js';
import { sheetStylePref } from './landscape-style.js';
import { closeSheets, isPhone } from './mobile.js';
import { history, state } from './state.js';
import { afterChange, mutate, pushHistory, snapshot } from './store.js';

export const VIEW_MIME = 'application/x-kepler-view';

let cache = null; // { stamp, url, denominator } — лист дорогой, панель перерисовывается часто
let pending = null; // stamp рендера в работе
let ed = null; // камера листа пользователя: { key, k, ox, oy, w, h }
let gesture = null; // { kind: 'move' | 'pan' | 'crop' | 'pinch', … }
let resizeObs = null;
let upgradeTimer = null; // отложенная перерисовка растра под зум
const touches = new Map(); // пальцы на листе: pointerId → { x, y } (px холста)
let viewOpener = null; // openView из ui/props-views.js (без циклического импорта)

const HANDLE_PX = 9; // радиус попадания в ручку обрезки
const HANDLE_CURSOR = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };

export function setViewOpener(fn) { viewOpener = fn; }

// Сообщить правой панели, что активный вид/лист сменился (ui/props.js слушает).
export function notifyViewChange() {
  document.dispatchEvent(new CustomEvent('kepler:view'));
}

export const isSheetOpen = () => state.sheetOpen != null;

// Лист по ключу: { spec, index, count, no } или null.
export function findSheet(key, specs = sheetList(state.project)) {
  const index = specs.findIndex((s) => sheetKey(s) === key);
  return index < 0 ? null : { spec: specs[index], index, count: specs.length, no: sheetNumber(specs[index], index) };
}

// Лист пользователя, открытый на холсте (или null).
export function openUserSheet() {
  const key = state.sheetOpen;
  return key?.startsWith('user:') ? findSheetById(state.project, key.slice(5)) : null;
}

// Знаменатель масштаба листа, если лист уже рисовали (иначе null).
export function sheetScaleOf(key) {
  return cache && cache.key === key ? cache.denominator : null;
}

export function openSheet(key) {
  if (!findSheet(key)) return false;
  state.sheetReturn = null;
  if (state.sheetOpen !== key) { state.sheetVp = null; ed = null; }
  state.sheetOpen = key;
  state.sheetSel = key;
  if (isPhone()) closeSheets(); // телефон: нижний лист уезжает, лист — во весь холст
  renderSheetView();
  notifyViewChange();
  return true;
}

export function closeSheet() {
  if (!isSheetOpen()) return;
  state.sheetOpen = null;
  state.sheetSel = null;
  state.sheetVp = null;
  state.sheetDrawn = null;
  ed = null;
  gesture = null;
  touches.clear();
  clearTimeout(upgradeTimer);
  upgradeTimer = null;
  dropZoomRasters(0);
  resizeObs?.disconnect();
  resizeObs = null;
  const box = el('sheetView');
  if (box) { box.hidden = true; box.innerHTML = ''; delete box.dataset.key; }
  notifyViewChange();
}

// PNG одного листа (150 dpi, как «Экспорт → Лист PNG»).
export function downloadSheetPng(key) {
  const found = findSheet(key);
  if (!found) return;
  const project = state.project;
  loadSheetImages(found.spec, project).then(() => {
    const sheet = renderSheet(project, found.spec, found.index + 1, found.count);
    sheet.toBlob((blob) => saveFile(`${safeFileName()}-лист-${found.no}.png`, blob, 'image/png'), 'image/png');
  });
  toast(`PNG: лист ${found.spec.kind === 'user' ? found.spec.sheet.format : 'A3'}, 150 dpi`);
}

// PDF одного листа.
export function downloadSheetPdf(key) {
  const found = findSheet(key);
  if (!found) return;
  const name = safeFileName();
  buildOneSheetPdf(state.project, key).then((pdf) => {
    if (pdf) saveFile(`${name}-лист-${found.no}.pdf`, pdf, 'application/pdf');
  });
  toast('PDF: этот лист');
}

// Номер записи истории — штамп меняется после каждой правки, даже когда
// длина истории упёрлась в предел.
const serials = new WeakMap();
let serialNext = 1;
function serial(entry) {
  if (!entry) return 0;
  if (!serials.has(entry)) serials.set(entry, serialNext++);
  return serials.get(entry);
}

function stampOf(key) {
  return `${key}/${serial(history.undo.at(-1))}/${serial(history.redo.at(-1))}/${history.undo.length}/${state.project.activeLevel}/${sheetStylePref()}`;
}

// После правок (в т. ч. Ctrl+Z): перерисовать или закрыть, если листа нет.
export function refreshSheetView() {
  if (!isSheetOpen()) return;
  if (!findSheet(state.sheetOpen)) { closeSheet(); return; }
  const user = openUserSheet();
  if (user) {
    if (state.sheetVp && !user.viewports.some((vp) => vp.id === state.sheetVp)) state.sheetVp = null;
    renderSheetView();
    return;
  }
  if (cache?.stamp !== stampOf(state.sheetOpen) || cache.project !== state.project) renderSheetView();
}

function renderSheetView() {
  const box = el('sheetView');
  const key = state.sheetOpen;
  const found = key && findSheet(key);
  if (!box || !found) return;
  if (found.spec.kind === 'user') { renderEditor(box, key, found); return; }
  delete box.dataset.key;
  resizeObs?.disconnect();
  resizeObs = null;
  const title = `Лист ${found.index + 1} — ${sheetTitle(state.project, found.spec)}`;
  box.hidden = false;
  box.innerHTML = `
    <div class="sheet-view-bar">
      <b class="sheet-view-title" id="sheetViewTitle">${escapeHtml(title)}</b>
      <span class="sheet-view-meta" id="sheetViewMeta">A3 · ${SHEET.w}×${SHEET.h} мм</span>
      <span class="sheet-view-gap"></span>
      <button type="button" class="primary" id="sheetViewPdf">Скачать PDF</button>
      <button type="button" id="sheetViewPng">PNG</button>
      <button type="button" id="sheetViewClose">✕ Закрыть лист</button>
    </div>
    <div class="sheet-view-body" id="sheetViewBody"><p class="hint">Готовлю лист…</p></div>`;
  box.querySelector('#sheetViewPdf').addEventListener('click', () => handleExport('sheet-pdf'));
  box.querySelector('#sheetViewPng').addEventListener('click', () => downloadSheetPng(key));
  box.querySelector('#sheetViewClose').addEventListener('click', closeSheet);
  const stamp = stampOf(key);
  const put = () => {
    const body = box.querySelector('#sheetViewBody');
    if (!body || state.sheetOpen !== key) return;
    const img = new Image();
    img.id = 'sheetViewImg';
    img.alt = title;
    img.src = cache.url;
    body.replaceChildren(img);
    const meta = box.querySelector('#sheetViewMeta');
    if (meta && cache.denominator) meta.textContent = `A3 · ${SHEET.w}×${SHEET.h} мм · М 1:${cache.denominator}`;
  };
  if (cache?.stamp === stamp && cache.project === state.project) { put(); return; }
  if (pending === stamp) return;
  pending = stamp;
  loadSheetImages(found.spec).then(() => {
    pending = null;
    const sheet = renderSheet(state.project, found.spec, found.index + 1, found.count);
    cache = { key, stamp, project: state.project, url: sheet.toDataURL('image/jpeg', 0.9), denominator: sheet.denominator || null };
    if (box.isConnected) put();
    notifyViewChange(); // масштаб — в «Свойствах» листа
  });
}

// ------------------------------------------------------------ лист пользователя

const ORIENT = { landscape: 'альбомная', portrait: 'книжная' };

function editorTitle(found) {
  return `Лист ${found.no} — ${found.spec.sheet.name}`;
}

function editorMeta(sheet) {
  const size = sheetSize(sheet);
  return `${sheet.format} · ${size.w}×${size.h} мм · ${ORIENT[sheet.orient]} · видов: ${sheet.viewports.length}`;
}

function renderEditor(box, key, found) {
  const sheet = found.spec.sheet;
  box.hidden = false;
  if (box.dataset.key !== key || !box.querySelector('#sheetCanvas')) {
    box.dataset.key = key;
    box.innerHTML = `
    <div class="sheet-view-bar">
      <b class="sheet-view-title" id="sheetViewTitle"></b>
      <span class="sheet-view-meta" id="sheetViewMeta"></span>
      <span class="sheet-view-gap"></span>
      <button type="button" id="sheetViewFit" title="Весь лист на экране">Вписать</button>
      <button type="button" class="primary" id="sheetViewPdf">Скачать PDF</button>
      <button type="button" id="sheetViewPng">PNG</button>
      <button type="button" id="sheetViewClose">✕ Закрыть лист</button>
    </div>
    <div class="sheet-view-body sheet-edit" id="sheetViewBody">
      <canvas id="sheetCanvas" tabindex="0" aria-label="Лист: перетащите вид из «Видов»"></canvas>
      <p class="sheet-edit-hint" id="sheetEditHint" hidden>Перетащите вид из вкладки «Виды» на лист или нажмите «На лист…» в «Свойствах» вида.</p>
    </div>`;
    box.querySelector('#sheetViewFit').addEventListener('click', () => { ed = null; drawEditor(); });
    box.querySelector('#sheetViewPdf').addEventListener('click', () => handleExport('sheet-pdf'));
    box.querySelector('#sheetViewPng').addEventListener('click', () => downloadSheetPng(key));
    box.querySelector('#sheetViewClose').addEventListener('click', closeSheet);
    bindEditor(box.querySelector('#sheetCanvas'));
    resizeObs?.disconnect();
    resizeObs = typeof ResizeObserver === 'function' ? new ResizeObserver(() => drawEditor()) : null;
    resizeObs?.observe(box.querySelector('#sheetViewBody'));
  }
  box.querySelector('#sheetViewTitle').textContent = editorTitle(found);
  box.querySelector('#sheetViewMeta').textContent = editorMeta(sheet);
  drawEditor();
  const project = state.project;
  if (sheet.viewports.some((vp) => viewportRaster(project, vp).pending)) {
    prepareViewports(project, sheet).then(() => { if (state.sheetOpen === key) drawEditor(); });
  }
}

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function fitCamera(w, h, size) {
  const pad = Math.min(24, Math.max(8, Math.min(w, h) * 0.04));
  const k = Math.max(0.05, Math.min((w - pad * 2) / size.w, (h - pad * 2) / size.h));
  return { k, ox: (w - size.w * k) / 2, oy: (h - size.h * k) / 2 };
}

export function drawEditor() {
  const canvas = el('sheetView')?.querySelector('#sheetCanvas');
  const sheet = openUserSheet();
  if (!canvas || !sheet) return;
  const body = canvas.parentElement;
  const w = Math.max(1, body.clientWidth);
  const h = Math.max(1, body.clientHeight);
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
  }
  const size = sheetSize(sheet);
  if (!ed || ed.key !== state.sheetOpen || ed.size !== `${size.w}x${size.h}`) {
    ed = { key: state.sheetOpen, size: `${size.w}x${size.h}`, ...fitCamera(w, h, size) };
  }
  const project = state.project;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = cssVar('--sheet-backdrop', '#d5dae1');
  ctx.fillRect(0, 0, w, h);
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.28)';
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = '#fff';
  ctx.fillRect(ed.ox, ed.oy, size.w * ed.k, size.h * ed.k);
  ctx.restore();
  ctx.setTransform(dpr * ed.k, 0, 0, dpr * ed.k, dpr * ed.ox, dpr * ed.oy);
  const f = zoomStep();
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, size.w, size.h);
  ctx.clip();
  drawViewports(ctx, project, sheet, { editor: true, f });
  drawSheetDecor(ctx, project, sheet, sheetList(project).length);
  ctx.restore();
  const sel = sheet.viewports.find((vp) => vp.id === state.sheetVp);
  if (sel) {
    const b = viewportBox(project, sel);
    const px = 1 / ed.k;
    const accent = cssVar('--accent', '#2f6fde');
    ctx.setLineDash([]);
    if (b.crop) { // весь вид — пунктиром: видно, что срезано
      ctx.strokeStyle = 'rgba(47,111,222,0.45)';
      ctx.lineWidth = px;
      ctx.setLineDash([5 * px, 4 * px]);
      ctx.strokeRect(b.full.x0, b.full.y0, b.full.x1 - b.full.x0, b.full.y1 - b.full.y0);
      ctx.setLineDash([]);
    }
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2 * px;
    ctx.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
    ctx.fillStyle = '#fff';
    const hs = 8 * px;
    ctx.lineWidth = 1.5 * px;
    for (const h of cropHandlePoints(b)) {
      ctx.fillRect(h.x - hs / 2, h.y - hs / 2, hs, hs);
      ctx.strokeRect(h.x - hs / 2, h.y - hs / 2, hs, hs);
    }
  }
  const hint = el('sheetView')?.querySelector('#sheetEditHint');
  if (hint) hint.hidden = sheet.viewports.length > 0;
  const numbers = viewportNumbers(sheet);
  state.sheetDrawn = {
    key: state.sheetOpen, sheetId: sheet.id, k: ed.k, ox: ed.ox, oy: ed.oy, w: size.w, h: size.h, selected: state.sheetVp, f,
    viewports: sheet.viewports.map((vp) => {
      const r = viewportRaster(project, vp);
      const shown = (f > 1 && cachedRaster(project, vp, f)) || r;
      return {
        id: vp.id, viewId: vp.viewId, x: vp.x, y: vp.y, scale: vp.scale, box: viewportBox(project, vp), empty: Boolean(r.empty), pending: Boolean(r.pending),
        no: numbers.get(vp.id), crop: vp.crop ? { ...vp.crop } : null, cam: vp.cam ? { ...vp.cam } : null,
        rasterF: shown.f || 1, rasterPx: shown.canvas ? shown.canvas.width : 0,
      };
    }),
  };
  scheduleUpgrade(f);
}

// Ступень растра под зум: пикселей экрана на мм листа против 150 dpi.
function zoomStep() {
  if (!ed) return 1;
  const need = (ed.k * (window.devicePixelRatio || 1)) / SHEET_PX;
  return need <= 1.2 ? 1 : need <= 2.4 ? 2 : 4;
}

// Растр нужной ступени — через 150 мс после последнего зума (колесо,
// щипок); пока его нет, рисуется ×1.
function scheduleUpgrade(f) {
  clearTimeout(upgradeTimer);
  upgradeTimer = null;
  const sheet = openUserSheet();
  if (f <= 1 || !sheet || sheet.viewports.every((vp) => rasterReady(state.project, vp, f))) return;
  upgradeTimer = setTimeout(() => {
    upgradeTimer = null;
    const cur = openUserSheet();
    if (!cur || zoomStep() !== f || gesture?.kind === 'pinch') return;
    dropZoomRasters(f);
    for (const vp of cur.viewports) viewportRaster(state.project, vp, f);
    drawEditor();
  }, 150);
}

function toMm(canvas, e) {
  const r = canvas.getBoundingClientRect();
  return { x: (e.clientX - r.left - ed.ox) / ed.k, y: (e.clientY - r.top - ed.oy) / ed.k };
}

// Ручка рамки обрезки выбранного вида под точкой p (мм листа) или null.
function hitCropHandle(sheet, p) {
  const vp = sheet.viewports.find((v) => v.id === state.sheetVp);
  if (!vp) return null;
  const b = viewportBox(state.project, vp);
  const r = HANDLE_PX / ed.k;
  const h = cropHandlePoints(b).find((q) => Math.abs(q.x - p.x) <= r && Math.abs(q.y - p.y) <= r);
  return h ? { vp, handle: h.id, box: b } : null;
}

// Шаг края рамки обрезки: 5 мм, вблизи (больше 6 px на мм) — 1 мм.
const cropStep = () => (ed && ed.k >= 6 ? 1 : 5);

function hitViewport(sheet, p) {
  for (let i = sheet.viewports.length - 1; i >= 0; i -= 1) {
    const vp = sheet.viewports[i];
    const b = viewportBox(state.project, vp);
    const inBox = p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1;
    const inCap = p.x >= b.cap.x0 && p.x <= b.cap.x1 && p.y >= b.cap.y0 && p.y <= b.cap.y1;
    if (inBox || inCap) return vp;
  }
  return null;
}

function selectViewport(id) {
  if (state.sheetVp === id) return;
  state.sheetVp = id;
  drawEditor();
  notifyViewChange();
}

const local = (canvas, e) => {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
};

// Второй палец: начатое одним пальцем отменяется (вид — на место), щипок.
function startPinch() {
  if (gesture?.kind === 'move' && gesture.moved) moveViewport(state.project, gesture.id, gesture.x0, gesture.y0, { snap: 0 });
  if (gesture?.kind === 'crop' && gesture.moved) {
    const vp = findViewport(state.project, gesture.id)?.vp;
    if (vp) { if (gesture.crop0) vp.crop = { ...gesture.crop0 }; else delete vp.crop; }
  }
  const [a, b] = [...touches.values()];
  gesture = {
    kind: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    k: ed.k, ox: ed.ox, oy: ed.oy, pid: null,
  };
}

// Щипок: масштаб по расстоянию между пальцами, точка листа под серединой в
// начале жеста остаётся под серединой пальцев.
function movePinch() {
  const pts = [...touches.values()];
  if (pts.length < 2) return;
  const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
  const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
  const g = gesture;
  const k = Math.min(40, Math.max(0.2, g.k * (dist / g.dist)));
  const sx = (g.mid.x - g.ox) / g.k;
  const sy = (g.mid.y - g.oy) / g.k;
  ed.k = k;
  ed.ox = mid.x - sx * k;
  ed.oy = mid.y - sy * k;
  drawEditor();
}

function bindEditor(canvas) {
  canvas.addEventListener('pointerdown', (e) => {
    const sheet = openUserSheet();
    if (!sheet || !ed) return;
    canvas.focus({ preventScroll: true });
    if (e.pointerType === 'touch') {
      touches.set(e.pointerId, local(canvas, e));
      canvas.setPointerCapture?.(e.pointerId);
      if (touches.size === 2) { startPinch(); return; }
      if (touches.size > 2) return;
    }
    const p = toMm(canvas, e);
    const grip = e.button === 0 ? hitCropHandle(sheet, p) : null;
    if (grip) {
      const { vp, box } = grip;
      const rect0 = box.crop || { x0: 0, y0: 0, x1: box.frame.w, y1: box.frame.h };
      gesture = {
        kind: 'crop', id: vp.id, handle: grip.handle, start: p, rect0, frame: box.frame, origin: { x: box.full.x0, y: box.full.y0 },
        crop0: vp.crop ? { ...vp.crop } : null, before: snapshot(), moved: false, pid: e.pointerId,
      };
      canvas.setPointerCapture?.(e.pointerId);
      e.preventDefault();
      return;
    }
    const hit = e.button === 0 ? hitViewport(sheet, p) : null;
    if (hit) {
      selectViewport(hit.id);
      gesture = { kind: 'move', id: hit.id, start: p, x0: hit.x, y0: hit.y, before: snapshot(), moved: false, pid: e.pointerId };
    } else if (e.button === 0 || e.button === 1) {
      if (e.button === 0) selectViewport(null);
      gesture = { kind: 'pan', sx: e.clientX, sy: e.clientY, ox: ed.ox, oy: ed.oy, pid: e.pointerId };
      e.preventDefault();
    } else return;
    canvas.setPointerCapture?.(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (touches.has(e.pointerId)) touches.set(e.pointerId, local(canvas, e));
    if (gesture?.kind === 'pinch') { if (touches.has(e.pointerId)) movePinch(); return; }
    if (!gesture || gesture.pid !== e.pointerId) {
      const sheet = openUserSheet();
      if (sheet && ed && !gesture) {
        const p = toMm(canvas, e);
        const grip = hitCropHandle(sheet, p);
        canvas.style.cursor = grip ? HANDLE_CURSOR[grip.handle] : hitViewport(sheet, p) ? 'move' : 'grab';
      }
      return;
    }
    if (gesture.kind === 'pan') {
      ed.ox = gesture.ox + (e.clientX - gesture.sx);
      ed.oy = gesture.oy + (e.clientY - gesture.sy);
      drawEditor();
      return;
    }
    const p = toMm(canvas, e);
    const dx = p.x - gesture.start.x;
    const dy = p.y - gesture.start.y;
    if (!gesture.moved && Math.hypot(dx, dy) * ed.k < 3) return;
    gesture.moved = true;
    if (gesture.kind === 'crop') {
      const vp = findViewport(state.project, gesture.id)?.vp;
      if (!vp) return;
      const rect = dragCropHandle(gesture.rect0, gesture.handle, dx, dy, {
        origin: gesture.origin, step: e.shiftKey ? 0 : cropStep(), bounds: gesture.frame,
      });
      const crop = cropFromPaper(rect, gesture.frame);
      if (crop) vp.crop = crop;
      drawEditor();
      return;
    }
    moveViewport(state.project, gesture.id, gesture.x0 + dx, gesture.y0 + dy, { snap: e.shiftKey ? 0 : undefined });
    drawEditor();
  });
  const end = (e) => {
    const touch = touches.delete(e.pointerId);
    if (gesture?.kind === 'pinch') {
      if (touch && touches.size < 2) { gesture = null; touches.clear(); drawEditor(); } // растр под новый зум
      canvas.releasePointerCapture?.(e.pointerId);
      return;
    }
    if (!gesture || gesture.pid !== e.pointerId) return;
    const g = gesture;
    gesture = null;
    canvas.releasePointerCapture?.(e.pointerId);
    if ((g.kind === 'move' || g.kind === 'crop') && g.moved) {
      pushHistory(g.before); // одна запись на жест
      afterChange();
    }
  };
  canvas.addEventListener('dblclick', (e) => {
    const sheet = openUserSheet();
    if (!sheet || !ed) return;
    const hit = hitViewport(sheet, toMm(canvas, e));
    if (hit) { e.preventDefault(); openViewFromSheet(hit.viewId); }
  });
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('wheel', (e) => {
    if (!ed) return;
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;
    const f = Math.exp(-e.deltaY * 0.0015);
    const k = Math.min(40, Math.max(0.2, ed.k * f));
    ed.ox = sx - ((sx - ed.ox) * k) / ed.k;
    ed.oy = sy - ((sy - ed.oy) * k) / ed.k;
    ed.k = k;
    drawEditor();
  }, { passive: false });
  canvas.addEventListener('dragover', (e) => {
    if (![...(e.dataTransfer?.types || [])].includes(VIEW_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  canvas.addEventListener('drop', (e) => {
    const viewId = e.dataTransfer?.getData(VIEW_MIME);
    const sheet = openUserSheet();
    if (!viewId || !sheet || !ed) return;
    e.preventDefault();
    const p = toMm(canvas, e);
    placeViewOnSheet(sheet.id, viewId, { x: snapMm(p.x), y: snapMm(p.y) });
  });
}

// ------------------------------------------------------------ команды

// Положить вид на лист (в точку at, мм листа; нет — в центр поля чертежа)
// с масштабом, при котором он помещается. Вид уже на листе — сообщение.
export function placeViewOnSheet(sheetId, viewId, at = null) {
  const project = state.project;
  const other = sheetOfView(project, viewId);
  if (other) { toast(`Вид уже размещён на листе ${other.no}`, true); return null; }
  const sheet = findSheetById(project, sheetId);
  const desc = viewById(project, viewId);
  if (!sheet || !desc) { toast('Вид не найден', true); return null; }
  const scale = defaultViewportScale(project, viewId, sheet);
  let vp = null;
  mutate(() => {
    const c = at ? fitInFrame(project, sheet, viewId, scale, at.x, at.y) : freeSpot(project, sheet, viewId, scale);
    vp = placeView(state.project, sheetId, viewId, { x: snapMm(c.x), y: snapMm(c.y), scale }).viewport || null;
    if (vp) state.sheetVp = vp.id;
  });
  if (vp) toast(`${desc.name} — на листе ${sheet.no}, М 1:${scale}`);
  return vp;
}

// Новый лист «Лист N» (A3 альбомный), выбран в «Листах».
export function addUserSheet(opts = {}) {
  const no = nextSheetNo(state.project, autoSheetCount(state.project));
  let sheet = null;
  mutate(() => { sheet = addSheet(state.project, { no, ...opts }); });
  state.sheetSel = `user:${sheet.id}`;
  notifyViewChange();
  return sheet;
}

export function deleteUserSheet(id) {
  if (state.sheetOpen === `user:${id}`) closeSheet();
  if (state.sheetSel === `user:${id}`) state.sheetSel = null;
  mutate(() => { removeSheet(state.project, id); });
}

export function editUserSheet(id, patch) {
  mutate(() => { updateSheet(state.project, id, patch); });
}

export function removeSelectedViewport() {
  const id = state.sheetVp;
  if (!id || !findViewport(state.project, id)) return false;
  state.sheetVp = null;
  mutate(() => { removeViewport(state.project, id); });
  return true;
}

// Масштаб выбранного вида. Обрезанный вид: рамка обрезки (мм модели)
// масштабируется с видом, центр видимой части остаётся на месте листа.
export function setSelectedViewportScale(scale) {
  const id = state.sheetVp;
  if (!id) return;
  mutate(() => {
    const vp = findViewport(state.project, id)?.vp;
    if (!vp) return;
    const b0 = viewportBox(state.project, vp);
    setViewportScale(state.project, id, scale);
    if (!b0.crop) return;
    const b1 = viewportBox(state.project, vp);
    vp.x = Math.round((vp.x + (b0.x0 + b0.x1) / 2 - (b1.x0 + b1.x1) / 2) * 10) / 10;
    vp.y = Math.round((vp.y + (b0.y0 + b0.y1) / 2 - (b1.y0 + b1.y1) / 2) * 10) / 10;
  });
}

function mutateSelectedVp(fn) {
  const id = state.sheetVp;
  if (!id || !findViewport(state.project, id)) return;
  mutate(() => {
    const found = findViewport(state.project, id);
    if (found) fn(found.vp, found.sheet);
  });
}

// «Обрезать вид»: включить — прежняя рамка или весь вид; выключить —
// рамка помнится (crop.off).
export function setSelectedViewportCrop(on) {
  mutateSelectedVp((vp) => {
    if (!on) { if (vp.crop) vp.crop.off = true; return; }
    if (vp.crop) { delete vp.crop.off; return; }
    const { frame } = viewportBox(state.project, vp);
    const crop = cropFromPaper({ x0: 0, y0: 0, x1: frame.w, y1: frame.h }, frame);
    if (crop) vp.crop = crop;
  });
}

export function resetSelectedViewportCrop() {
  mutateSelectedVp((vp) => { delete vp.crop; });
}

// Номер вида на листе: пусто — по порядку; занятый другим видом — отказ.
export function setSelectedViewportNo(value) {
  const no = String(value ?? '').trim().slice(0, 8);
  const found = state.sheetVp && findViewport(state.project, state.sheetVp);
  if (!found) return false;
  if (no && [...viewportNumbers(found.sheet)].some(([id, n]) => id !== found.vp.id && n === no)) {
    toast(`Номер ${no} уже занят на листе ${found.sheet.no}`, true);
    return false;
  }
  mutateSelectedVp((vp) => { if (no) vp.no = no; else delete vp.no; });
  return true;
}

// Камера 3D-вида на листе: снимок камеры окна 3D (null — аксонометрия).
export function setSelectedViewportCam(cam) {
  mutateSelectedVp((vp) => {
    const c = normalizeCam(cam);
    if (c) vp.cam = c; else delete vp.cam;
  });
}

// Двойной клик по виду на листе: открыть сам вид; лист закрывается, Esc
// (или «↩ К листу») возвращает к нему.
export function openViewFromSheet(viewId) {
  const key = state.sheetOpen;
  const place = viewPlacement(state.project, viewId);
  if (!viewOpener || !viewById(state.project, viewId)) return false;
  viewOpener(viewId);
  state.sheetReturn = key;
  if (place) toast(`${viewById(state.project, viewId).name} · Esc — назад к листу ${place.sheet.no}`);
  notifyViewChange();
  return true;
}

// Вернуться к листу, с которого открыт вид (Esc). false — возвращаться некуда.
export function returnToSheet() {
  const key = state.sheetReturn;
  state.sheetReturn = null;
  if (!key || !findSheet(key)) return false;
  openSheet(key);
  return true;
}

export function setSelectedViewportTitle(title) {
  const found = state.sheetVp && findViewport(state.project, state.sheetVp);
  if (!found) return;
  mutate(() => {
    const vp = findViewport(state.project, state.sheetVp)?.vp;
    if (!vp) return;
    if (String(title || '').trim()) vp.title = String(title).trim(); else delete vp.title;
  });
}

// Клавиши открытого листа: Delete — убрать выбранный вид, Esc — снять выбор.
export function handleSheetKey(event) {
  if (!openUserSheet() || !state.sheetVp) return false;
  const tag = event.target?.tagName || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return false;
  if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault();
    removeSelectedViewport();
    return true;
  }
  if (event.key === 'Escape') {
    selectViewport(null);
    return true;
  }
  return false;
}

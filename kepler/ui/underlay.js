// Подложка-топосъёмка: загрузка JPG/PNG/PDF/DXF, калибровка масштаба.

import { dxfToImage, dxfTypeSummary, parseDxf } from '../core/dxf.js';
import { canvas, el, toast } from './dom.js';
import { renderLibrary } from './library.js';
import { state } from './state.js';
import { mutate } from './store.js';
import { selectObject, setHint } from './tools.js';
import { fitView, requestDraw, screenToWorld, worldToScreen } from './view.js';

const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174';

export function syncUnderlayImage() {
  const src = state.project.site?.underlay?.src;
  if (!src) { state.underlayImg = null; return; }
  if (state.underlayImg?.dataset?.src === src) return;
  const img = new Image();
  img.dataset.src = src;
  img.onload = () => requestDraw();
  img.src = src;
  state.underlayImg = img;
}

export function addCalibratePoint(world) {
  const points = state.tool.points;
  points.push({ x: world.x, y: world.y });
  if (points.length < 2) {
    setHint('Теперь кликните вторую точку отрезка');
    requestDraw();
    return;
  }
  const measured = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
  if (measured < 1) { toast('Точки слишком близко — кликните дальше'); state.tool.points = [points[0]]; return; }
  // Отрезок начерчен — показываем поле прямо на линии (как в Revit/ArchiCAD).
  state.calibration = { p1: points[0], p2: points[1], measured };
  state.tool = null;
  state.calCursor = null;
  setHint('');
  renderLibrary();
  requestDraw();
  showCalInput();
}

function showCalInput() {
  const overlay = el('calOverlay');
  const input = el('calInput');
  input.value = '';
  overlay.hidden = false;
  positionCalInput();
  setTimeout(() => input.focus(), 30);
}

export function positionCalInput() {
  const overlay = el('calOverlay');
  if (overlay.hidden || !state.calibration) return;
  const c = state.calibration;
  const mid = worldToScreen((c.p1.x + c.p2.x) / 2, (c.p1.y + c.p2.y) / 2);
  // Смещаем чуть выше линии, чтобы не перекрывать её.
  overlay.style.left = `${mid.x}px`;
  overlay.style.top = `${mid.y - 26}px`;
}

export function hideCalInput() {
  el('calOverlay').hidden = true;
  state.calibration = null;
  requestDraw();
}

export function applyCalibration(realMeters) {
  const site = state.project.site;
  const cal = state.calibration;
  if (!site.underlay || !cal) return;
  const realMm = realMeters * 1000;
  if (!(realMm > 10)) { toast('Введите длину отрезка в метрах'); return; }
  const k = realMm / cal.measured;
  mutate(() => {
    const u = site.underlay;
    u.mmPerPx *= k;
    u.x = cal.p1.x - (cal.p1.x - u.x) * k;
    u.y = cal.p1.y - (cal.p1.y - u.y) * k;
  });
  hideCalInput();
  selectObject({ type: 'site', kind: 'underlay' });
  toast('Масштаб топосъёмки задан по отрезку');
}

// --- Загрузка топосъёмки ---

export async function loadUnderlayFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.dwg')) {
    toast('DWG (бинарный) в браузере не читается. Сохраните как DXF (в CAD: Save As → DXF) или PDF/JPG и загрузите.', true);
    return;
  }
  try {
    if (name.endsWith('.dxf')) {
      const text = await file.text();
      const parsed = parseDxf(text);
      const summary = dxfTypeSummary(parsed);
      let info;
      try {
        info = dxfToImage(parsed);
      } catch (e) {
        toast(`DXF прочитан, но рисовать нечего (${summary || 'нет поддерживаемых объектов'}). Возможно, чертёж из блоков INSERT или это бинарный DXF — пришлите файл, добавлю поддержку.`, true);
        return;
      }
      placeUnderlay(info.dataUrl, info.size, info.reliableScale ? info.worldWidthMm : null);
      if (state.modeName === 'site') fitView(); // сразу вписываем в экран
      const proxy = /PROXY/i.test(summary);
      const base = `DXF: ${info.entityCount} объектов${summary ? ` (${summary})` : ''}`;
      if (proxy) {
        // Часть/вся геометрия — в проприетарных proxy-объектах, их не прочитать.
        toast(`${base}. Если пусто/мало — геометрия в проприетарных proxy-объектах: в CAD расчлените чертёж (EXPLODE / «Расчленить») и «Сохранить как» DXF R12/2000, либо импортируйте PDF.`, true);
      } else if (info.reliableScale) {
        toast(`${base}, ширина ≈ ${info.worldWidthM.toFixed(1)} м${info.hadUnits ? '' : ' (единицы приняты за метры)'}. Масштаб — справа.`, true);
      } else {
        toast(`${base}. Единицы непонятны — поставил удобный размер. Задайте масштаб: «Ширина, м» или «по отрезку» справа.`, true);
      }
      return;
    }
    let dataUrl;
    let size;
    if (name.endsWith('.pdf') || file.type === 'application/pdf') {
      ({ dataUrl, size } = await renderPdfToImage(file));
    } else {
      ({ dataUrl, size } = await downscaleImage(file));
    }
    placeUnderlay(dataUrl, size);
  } catch (error) {
    toast(`Не удалось загрузить: ${error.message}`, true);
  }
}

function downscaleImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('файл не прочитался'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('это не изображение'));
      img.onload = () => {
        const maxDim = 2200;
        const k = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.round(img.width * k);
        const h = Math.round(img.height * k);
        const cnv = document.createElement('canvas');
        cnv.width = w; cnv.height = h;
        const c = cnv.getContext('2d');
        c.fillStyle = '#ffffff';
        c.fillRect(0, 0, w, h);
        c.drawImage(img, 0, 0, w, h);
        resolve({ dataUrl: cnv.toDataURL('image/jpeg', 0.85), size: { w, h } });
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

async function ensurePdfJs() {
  if (window.pdfjsLib) return window.pdfjsLib;
  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `${PDFJS}/pdf.min.js`;
    script.onload = resolve;
    script.onerror = () => reject(new Error('библиотека PDF недоступна (нужен интернет)'));
    document.head.appendChild(script);
  });
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDFJS}/pdf.worker.min.js`;
  return window.pdfjsLib;
}

async function renderPdfToImage(file) {
  const pdfjs = await ensurePdfJs();
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buffer }).promise;
  const page = await pdf.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(3, 2200 / Math.max(base.width, base.height));
  const viewport = page.getViewport({ scale });
  const cnv = document.createElement('canvas');
  cnv.width = Math.round(viewport.width);
  cnv.height = Math.round(viewport.height);
  const c = cnv.getContext('2d');
  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, cnv.width, cnv.height);
  await page.render({ canvasContext: c, viewport }).promise;
  return { dataUrl: cnv.toDataURL('image/jpeg', 0.85), size: { w: cnv.width, h: cnv.height } };
}

function placeUnderlay(dataUrl, size, worldWidthMm = null) {
  const center = screenToWorld(canvas.clientWidth / 2, canvas.clientHeight / 2);
  // Если известна реальная ширина (из DXF) — масштаб 1:1; иначе картинка
  // занимает ~70% ширины видимой области.
  const visibleWorldWidth = canvas.clientWidth / state.view.scale;
  const mmPerPx = worldWidthMm && worldWidthMm > 0
    ? worldWidthMm / size.w
    : (visibleWorldWidth * 0.7) / size.w;
  mutate(() => {
    state.project.site.underlay = {
      src: dataUrl,
      x: center.x - (size.w * mmPerPx) / 2,
      y: center.y - (size.h * mmPerPx) / 2,
      widthPx: size.w,
      heightPx: size.h,
      mmPerPx,
      rot: 0,
      opacity: 0.7,
      locked: false,
    };
  });
  selectObject({ type: 'site', kind: 'underlay' });
  toast('Топосъёмка загружена. Задайте масштаб справа: впишите ширину в метрах, или тяните углы картинки', true);
}

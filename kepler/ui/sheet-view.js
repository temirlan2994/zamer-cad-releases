// Лист, открытый на холсте (двойной клик в «Листах», как в Revit): тот же
// рендер, что и в PDF (ui/sheet.js), во всю область холста; кнопки «Скачать
// PDF», «PNG», «Закрыть лист». Esc и «Закрыть лист» возвращают вид, который
// был открыт: режим и этаж не меняются, лист лишь накрывает холст.
// Размещение видов на листе (перетаскивание из «Видов») — следующий шаг;
// сейчас лист показывает то, что собирает sheetPlan().

import { saveFile } from './cloud.js';
import { el, escapeHtml, toast } from './dom.js';
import { handleExport, safeFileName } from './files.js';
import { SHEET, loadSheetImages, renderSheet, sheetKey, sheetPlan, sheetTitle } from './sheet.js';
import { sheetStylePref } from './landscape-style.js';
import { closeSheets, isPhone } from './mobile.js';
import { history, state } from './state.js';

let cache = null; // { stamp, url, denominator } — лист дорогой, панель перерисовывается часто
let pending = null; // stamp рендера в работе

// Сообщить правой панели, что активный вид/лист сменился (ui/props.js слушает).
export function notifyViewChange() {
  document.dispatchEvent(new CustomEvent('kepler:view'));
}

export const isSheetOpen = () => state.sheetOpen != null;

// Лист по ключу: { spec, index, count } или null.
export function findSheet(key, specs = sheetPlan(state.project)) {
  const index = specs.findIndex((s) => sheetKey(s) === key);
  return index < 0 ? null : { spec: specs[index], index, count: specs.length };
}

// Знаменатель масштаба листа, если лист уже рисовали (иначе null).
export function sheetScaleOf(key) {
  return cache && cache.key === key ? cache.denominator : null;
}

export function openSheet(key) {
  if (!findSheet(key)) return false;
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
  const box = el('sheetView');
  if (box) { box.hidden = true; box.innerHTML = ''; }
  notifyViewChange();
}

// PNG одного листа (150 dpi, как «Экспорт → Лист PNG»).
export function downloadSheetPng(key) {
  const found = findSheet(key);
  if (!found) return;
  loadSheetImages(found.spec).then(() => {
    const sheet = renderSheet(state.project, found.spec, found.index + 1, found.count);
    sheet.toBlob((blob) => saveFile(`${safeFileName()}-лист-${found.index + 1}.png`, blob, 'image/png'), 'image/png');
  });
  toast('PNG: лист A3, 150 dpi');
}

function stampOf(key) {
  return `${key}/${history.undo.length}/${history.redo.length}/${state.project.activeLevel}/${sheetStylePref()}`;
}

// После правок (в т. ч. Ctrl+Z): перерисовать или закрыть, если листа нет.
export function refreshSheetView() {
  if (!isSheetOpen()) return;
  if (!findSheet(state.sheetOpen)) { closeSheet(); return; }
  if (cache?.stamp !== stampOf(state.sheetOpen) || cache.project !== state.project) renderSheetView();
}

function renderSheetView() {
  const box = el('sheetView');
  const key = state.sheetOpen;
  const found = key && findSheet(key);
  if (!box || !found) return;
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

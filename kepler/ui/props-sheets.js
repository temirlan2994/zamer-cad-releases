// Вкладка «Листы» правой панели: альбом A3 (ui/sheet.js) — список листов
// (генплан, разрезы участка, этажи), предпросмотр листа и выгрузка PDF/PNG
// (те же команды, что в меню «Экспорт»), настройки листа генплана.

import { escapeHtml } from './dom.js';
import { handleExport } from './files.js';
import { setSheetStylePref, sheetStylePref } from './landscape-style.js';
import { loadSheetImages, renderSheet, sheetPlan } from './sheet.js';
import { history, state } from './state.js';

let previewIndex = null; // номер листа в предпросмотре (пока открыта вкладка)
let previewCache = null; // { key, url } — панель перерисовывается часто, лист — дорогой

function sheetTitle(spec) {
  if (spec.kind === 'site') return 'Генплан';
  if (spec.kind === 'sections') return `Разрезы участка (${spec.place.length})`;
  const level = state.project.levels.find((l) => l.id === spec.levelId);
  return `План: ${level?.name || 'этаж'}`;
}

export function renderSheetsPanel(panel) {
  const specs = sheetPlan(state.project);
  if (previewIndex != null && previewIndex >= specs.length) previewIndex = null;
  const current = specs.findIndex((s) => (state.modeName === 'plan'
    ? s.kind === 'level' && s.levelId === state.project.activeLevel : s.kind === 'site'));
  panel.innerHTML = `
    <h2>Листы</h2>
    <p class="subtitle">Альбом A3 с рамкой и штампом: генплан, разрезы, этажи.</p>
    ${specs.length ? `
    <ol class="sheets-list" id="sheetsList">
      ${specs.map((s, i) => `<li class="sheets-item${i === current ? ' current' : ''}${i === previewIndex ? ' active' : ''}">
        <span class="sheets-no">${i + 1}</span><span class="sheets-name">${escapeHtml(sheetTitle(s))}</span>
        <button type="button" class="link" data-sheet-preview="${i}">${i === previewIndex ? 'Скрыть' : 'Просмотр'}</button></li>`).join('')}
    </ol>
    <div class="sheets-preview" id="sheetsPreview"${previewIndex == null ? ' hidden' : ''}></div>` : `
    <p class="empty-hint" id="sheetsEmpty">Нечего печатать: добавьте комнаты на этаже или границу участка.</p>`}
    <div class="prop-actions">
      <button type="button" class="primary" id="sheetsPdfBtn" ${specs.length ? '' : 'disabled'}>Скачать PDF — все листы</button>
      <button type="button" id="sheetsPngBtn" ${current >= 0 ? '' : 'disabled'}>PNG — лист текущего ${state.modeName === 'plan' ? 'этажа' : 'генплана'}</button>
    </div>
    <h3>Оформление</h3>
    <div class="prop-block">
      <label class="check-row"><input type="checkbox" id="sheetsLsScreen" ${sheetStylePref() === 'screen' ? 'checked' : ''}><span>Генплан на листе — как на экране (иначе «Чертёж»)</span></label>
      <p class="hint">Разрезы на лист отмечаются в режиме «Ландшафт» (сводка → «Разрезы»). Ландшафт под планом этажа на лист не выводится.</p>
    </div>`;
  if (previewIndex != null) showPreview(panel, specs, previewIndex);
  panel.querySelectorAll('[data-sheet-preview]').forEach((b) => b.addEventListener('click', () => {
    const i = Number(b.dataset.sheetPreview);
    previewIndex = previewIndex === i ? null : i;
    renderSheetsPanel(panel);
  }));
  panel.querySelector('#sheetsPdfBtn')?.addEventListener('click', () => handleExport('sheet-pdf'));
  panel.querySelector('#sheetsPngBtn')?.addEventListener('click', () => handleExport('sheet-png'));
  panel.querySelector('#sheetsLsScreen')?.addEventListener('change', (e) => setSheetStylePref(e.target.checked ? 'screen' : 'drawing'));
}

// Предпросмотр — тот же рендер листа, что и в PDF, уменьшенной картинкой.
function showPreview(panel, specs, i) {
  const box = panel.querySelector('#sheetsPreview');
  if (!box) return;
  const spec = specs[i];
  const key = `${i}/${specs.length}/${history.undo.length}/${history.redo.length}/${state.project.activeLevel}`;
  const put = (url) => {
    const img = new Image();
    img.alt = `Лист ${i + 1}: ${sheetTitle(spec)}`;
    img.id = 'sheetsPreviewImg';
    img.src = url;
    box.replaceChildren(img);
  };
  if (previewCache?.key === key && previewCache.project === state.project) { put(previewCache.url); return; }
  box.innerHTML = '<p class="hint">Готовлю лист…</p>';
  loadSheetImages(spec).then(() => {
    const sheet = renderSheet(state.project, spec, i + 1, specs.length);
    previewCache = { key, project: state.project, url: sheet.toDataURL('image/jpeg', 0.85) };
    if (box.isConnected) put(previewCache.url);
  });
}

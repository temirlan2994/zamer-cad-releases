// Листы альбома, как «Листы» в диспетчере Revit.
// Вкладка «Листы» правой панели — список листов: автолисты A3 (генплан,
// разрезы участка, этажи — ui/sheet.js sheetPlan()) и листы пользователя
// (project.sheets: «+ Лист», виды кладутся на лист перетаскиванием из
// «Видов»). Клик — выбрать (в «Свойствах» — настройки листа), двойной клик
// или «Открыть» — открыть лист на холсте (ui/sheet-view.js). Выгрузка
// PDF/PNG — те же команды, что в меню «Экспорт».
// «Свойства» листа пользователя: название, номер, формат, ориентация,
// «Удалить лист»; выбран вид на открытом листе — его масштаб, подпись,
// «Убрать с листа».

import { mutate } from './store.js';
import {
  SHEET_FORMAT_LIST, findViewport, sheetSize, viewById, viewportNo, viewportNumbers, viewportScales, viewportTitle,
} from '../core/views.js';
import { escapeHtml } from './dom.js';
import { handleExport } from './files.js';
import { setSheetStylePref, sheetStylePref } from './landscape-style.js';
import { SHEET, sheetKey, sheetList, sheetNumber, sheetTitle } from './sheet.js';
import {
  addUserSheet, closeSheet, deleteUserSheet, downloadSheetPdf, downloadSheetPng, editUserSheet, findSheet, notifyViewChange,
  openSheet, openViewFromSheet, removeSelectedViewport, resetSelectedViewportCrop, setSelectedViewportCam,
  setSelectedViewportCrop, setSelectedViewportNo, setSelectedViewportScale, setSelectedViewportTitle, sheetScaleOf,
} from './sheet-view.js';
import { state } from './state.js';
import { camera3dSnapshot } from './view3d.js';

const CONTENTS = {
  site: 'Генплан, таблица участка, условные обозначения',
  sections: 'Разрезы участка',
  level: 'План этажа и экспликация помещений',
};
const ORIENT = { landscape: 'альбомная', portrait: 'книжная' };

export function renderSheetsPanel(panel) {
  const project = state.project;
  const specs = sheetList(project);
  if (state.sheetSel && !findSheet(state.sheetSel, specs)) state.sheetSel = null;
  const selected = state.sheetSel;
  const autoOn = project.sheetsAuto !== false;
  panel.innerHTML = `
    <h2>Листы</h2>
    <p class="subtitle">Альбом с рамкой и штампом. Клик — выбрать, двойной клик — открыть лист. На свой лист виды перетаскиваются из «Видов».</p>
    <div class="prop-actions sheets-top">
      <button type="button" id="sheetsAddBtn" title="Новый лист A3, альбомный">+ Лист</button>
    </div>
    ${specs.length ? `
    <ol class="sheets-list" id="sheetsList" role="listbox" aria-label="Листы">
      ${specs.map((s, i) => {
    const key = sheetKey(s);
    const open = key === state.sheetOpen;
    const user = s.kind === 'user';
    return `<li class="sheets-item${key === selected ? ' active' : ''}${open ? ' current' : ''}${user ? ' user' : ''}" role="option" tabindex="0"
        data-sheet="${escapeHtml(key)}" aria-selected="${key === selected}">
        <span class="sheets-no">${escapeHtml(sheetNumber(s, i))}</span><span class="sheets-name">${escapeHtml(sheetTitle(project, s))}${user ? ` <small>${escapeHtml(s.sheet.format)} · видов ${s.sheet.viewports.length}</small>` : ''}</span>
        <button type="button" class="link" data-sheet-open="${escapeHtml(key)}">${open ? 'Закрыть' : 'Открыть'}</button>
        ${user ? `<button type="button" class="link sheets-del" data-sheet-del="${escapeHtml(s.id)}" title="Удалить лист (Ctrl+Z — вернуть)" aria-label="Удалить лист">✕</button>` : ''}</li>`;
  }).join('')}
    </ol>` : `
    <p class="empty-hint" id="sheetsEmpty">Листов нет: «+ Лист» — свой лист; автолисты появятся, когда будут комнаты на этаже или граница участка.</p>`}
    <div class="prop-actions">
      <button type="button" class="primary" id="sheetsPdfBtn" ${specs.length ? '' : 'disabled'}>Скачать PDF — все листы</button>
      <button type="button" id="sheetsPngBtn" ${specs.length ? '' : 'disabled'}>${selected ? 'PNG — выбранный лист' : `PNG — лист текущего ${state.modeName === 'plan' ? 'этажа' : 'генплана'}`}</button>
    </div>
    <h3>Оформление</h3>
    <div class="prop-block">
      <label class="check-row"><input type="checkbox" id="sheetsAuto" ${autoOn ? 'checked' : ''}><span>Автолисты: генплан, разрезы участка, планы этажей</span></label>
      <label class="check-row"><input type="checkbox" id="sheetsLsScreen" ${sheetStylePref() === 'screen' ? 'checked' : ''}><span>Генплан на листе — как на экране (иначе «Чертёж»)</span></label>
      <p class="hint">Разрезы на лист отмечаются в режиме «Ландшафт» (сводка → «Разрезы»). Ландшафт под планом этажа на лист не выводится.</p>
    </div>`;
  panel.querySelectorAll('[data-sheet]').forEach((li) => {
    const key = li.dataset.sheet;
    li.addEventListener('click', (e) => {
      if (e.target.closest('[data-sheet-open], [data-sheet-del]') || state.sheetSel === key) return;
      // Без перерисовки списка: второй клик двойного должен попасть в тот же узел.
      state.sheetSel = key;
      panel.querySelectorAll('[data-sheet]').forEach((n) => {
        const on = n === li;
        n.classList.toggle('active', on);
        n.setAttribute('aria-selected', String(on));
      });
      const png = panel.querySelector('#sheetsPngBtn');
      if (png) png.textContent = 'PNG — выбранный лист';
    });
    li.addEventListener('dblclick', (e) => {
      if (e.target.closest('[data-sheet-open], [data-sheet-del]')) return;
      openSheet(key);
    });
    li.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target === li) { e.preventDefault(); openSheet(key); }
    });
  });
  panel.querySelectorAll('[data-sheet-open]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.sheetOpen === state.sheetOpen) closeSheet({ restoreView: true });
    else openSheet(b.dataset.sheetOpen);
  }));
  panel.querySelectorAll('[data-sheet-del]').forEach((b) => b.addEventListener('click', () => deleteUserSheet(b.dataset.sheetDel)));
  panel.querySelector('#sheetsAddBtn').addEventListener('click', () => addUserSheet());
  panel.querySelector('#sheetsPdfBtn')?.addEventListener('click', () => handleExport('sheet-pdf'));
  panel.querySelector('#sheetsPngBtn')?.addEventListener('click', () => {
    if (state.sheetSel) downloadSheetPng(state.sheetSel);
    else handleExport('sheet-png');
  });
  panel.querySelector('#sheetsAuto').addEventListener('change', (e) => {
    const on = e.target.checked;
    if (!on && state.sheetOpen && !state.sheetOpen.startsWith('user:')) closeSheet();
    mutate(() => { if (on) delete state.project.sheetsAuto; else state.project.sheetsAuto = false; });
  });
  panel.querySelector('#sheetsLsScreen')?.addEventListener('change', (e) => setSheetStylePref(e.target.checked ? 'screen' : 'drawing'));
}

const prow = (k, v, id = '') => `<div class="prop-row"${id ? ` id="${id}"` : ''}><span>${k}</span><strong>${v}</strong></div>`;

// «Свойства» без выбора, когда лист открыт или выбран в «Листах». false —
// листа больше нет (тогда «Свойства» покажут вид).
export function renderSheetProps(panel) {
  const key = state.sheetOpen || state.sheetSel;
  const found = key && findSheet(key);
  if (!found) { state.sheetSel = null; return false; }
  if (found.spec.kind === 'user') {
    if (key === state.sheetOpen && state.sheetVp && renderViewportProps(panel, found)) return true;
    renderUserSheetProps(panel, key, found);
    return true;
  }
  const { spec, index } = found;
  const open = key === state.sheetOpen;
  const den = sheetScaleOf(key);
  panel.innerHTML = `
    <h2 id="sheetPropsTitle">Лист ${index + 1} — ${escapeHtml(sheetTitle(state.project, spec))}</h2>
    <p class="subtitle">Свойства листа${open ? ' · открыт на холсте' : ''}</p>
    <div class="prop-block" id="sheetProps">
      ${prow('Номер', index + 1)}
      ${prow('Формат', `A3 · ${SHEET.w}×${SHEET.h} мм`)}
      ${prow('Ориентация', 'альбомная')}
      ${prow('Масштаб', den ? `1:${den} · авто` : 'авто — по размеру чертежа', 'sheetPropScale')}
    </div>
    <p class="hint" id="sheetPropContents">На листе: ${CONTENTS[spec.kind] || ''}.</p>
    ${spec.kind === 'site' ? `
    <h3>Оформление</h3>
    <div class="prop-block">
      <label class="check-row"><input type="checkbox" id="sheetPropLsScreen" ${sheetStylePref() === 'screen' ? 'checked' : ''}><span>Генплан — как на экране (иначе «Чертёж»)</span></label>
    </div>` : ''}
    <div class="prop-actions">
      <button type="button" class="primary" id="sheetPropOpen">${open ? 'Закрыть лист' : 'Открыть лист'}</button>
      <button type="button" id="sheetPropPng">PNG — этот лист</button>
      <button type="button" id="sheetPropPdf">Скачать PDF — все листы</button>
    </div>
    <p class="hint">Автолист: масштаб и раскладка — по чертежу. Свою раскладку видов — на листе «+ Лист» во вкладке «Листы».</p>
    ${open ? '' : '<button type="button" class="link" id="sheetPropBack">← Свойства вида</button>'}`;
  panel.querySelector('#sheetPropOpen').addEventListener('click', () => (open ? closeSheet({ restoreView: true }) : openSheet(key)));
  panel.querySelector('#sheetPropPng').addEventListener('click', () => downloadSheetPng(key));
  panel.querySelector('#sheetPropPdf').addEventListener('click', () => handleExport('sheet-pdf'));
  panel.querySelector('#sheetPropLsScreen')?.addEventListener('change', (e) => {
    setSheetStylePref(e.target.checked ? 'screen' : 'drawing');
    notifyViewChange();
  });
  panel.querySelector('#sheetPropBack')?.addEventListener('click', () => { state.sheetSel = null; notifyViewChange(); });
  return true;
}

function renderUserSheetProps(panel, key, found) {
  const sheet = found.spec.sheet;
  const open = key === state.sheetOpen;
  const size = sheetSize(sheet);
  const project = state.project;
  panel.innerHTML = `
    <h2 id="sheetPropsTitle">Лист ${escapeHtml(sheet.no)} — ${escapeHtml(sheet.name)}</h2>
    <p class="subtitle">Свойства листа${open ? ' · открыт на холсте' : ''}</p>
    <div class="prop-block" id="sheetProps">
      <label class="prop-field"><span>Название</span><input id="sheetPropName" type="text" value="${escapeHtml(sheet.name)}" maxlength="80"></label>
      <label class="prop-field"><span>Номер</span><input id="sheetPropNo" type="text" value="${escapeHtml(sheet.no)}" maxlength="12"></label>
      <label class="prop-field"><span>Формат</span><select id="sheetPropFormat">
        ${SHEET_FORMAT_LIST.map((f) => `<option value="${f}"${f === sheet.format ? ' selected' : ''}>${f}</option>`).join('')}</select></label>
      <label class="prop-field"><span>Ориентация</span><select id="sheetPropOrient">
        ${Object.entries(ORIENT).map(([v, t]) => `<option value="${v}"${v === sheet.orient ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
      ${prow('Размер', `${size.w}×${size.h} мм`, 'sheetPropSize')}
    </div>
    <h3>Виды на листе</h3>
    ${sheet.viewports.length ? `<ul class="sheet-vp-list" id="sheetVpList">
      ${(() => {
    const nums = viewportNumbers(sheet);
    return sheet.viewports.map((vp) => `<li><b class="sheet-vp-no">${escapeHtml(nums.get(vp.id))}</b><span>${escapeHtml(viewportTitle(project, vp))}</span><em>1:${vp.scale}${vp.crop && !vp.crop.off ? ' · обрезан' : ''}</em></li>`).join('');
  })()}
    </ul>` : '<p class="hint" id="sheetVpEmpty">Пусто. Откройте лист и перетащите вид из вкладки «Виды» (на телефоне — «На лист…» в «Свойствах» вида).</p>'}
    <div class="prop-actions">
      <button type="button" class="primary" id="sheetPropOpen">${open ? 'Закрыть лист' : 'Открыть лист'}</button>
      <button type="button" id="sheetPropPdfOne">PDF — этот лист</button>
      <button type="button" id="sheetPropPng">PNG — этот лист</button>
      <button type="button" id="sheetPropPdf">Скачать PDF — все листы</button>
      <button type="button" class="danger" id="sheetPropDelete">Удалить лист</button>
    </div>
    ${open ? '<p class="hint">Клик по виду — выбрать; тяните — сдвиг (шаг 5 мм, Shift — свободно); Delete — убрать с листа. Колесо — масштаб листа.</p>' : '<button type="button" class="link" id="sheetPropBack">← Свойства вида</button>'}`;
  const id = sheet.id;
  panel.querySelector('#sheetPropName').addEventListener('change', (e) => editUserSheet(id, { name: e.target.value }));
  panel.querySelector('#sheetPropNo').addEventListener('change', (e) => editUserSheet(id, { no: e.target.value }));
  panel.querySelector('#sheetPropFormat').addEventListener('change', (e) => editUserSheet(id, { format: e.target.value }));
  panel.querySelector('#sheetPropOrient').addEventListener('change', (e) => editUserSheet(id, { orient: e.target.value }));
  panel.querySelector('#sheetPropOpen').addEventListener('click', () => (open ? closeSheet({ restoreView: true }) : openSheet(key)));
  panel.querySelector('#sheetPropPdfOne').addEventListener('click', () => downloadSheetPdf(key));
  panel.querySelector('#sheetPropPng').addEventListener('click', () => downloadSheetPng(key));
  panel.querySelector('#sheetPropPdf').addEventListener('click', () => handleExport('sheet-pdf'));
  panel.querySelector('#sheetPropDelete').addEventListener('click', () => deleteUserSheet(id));
  panel.querySelector('#sheetPropBack')?.addEventListener('click', () => { state.sheetSel = null; notifyViewChange(); });
}

// «Свойства» видового экрана, выбранного на открытом листе.
function renderViewportProps(panel, found) {
  const hit = findViewport(state.project, state.sheetVp);
  if (!hit || hit.sheet.id !== found.spec.sheet.id) return false;
  const { vp } = hit;
  const desc = viewById(state.project, vp.viewId);
  const scales = [...new Set([...viewportScales(desc?.kind), vp.scale])].sort((a, b) => a - b);
  const no = viewportNo(hit.sheet, vp);
  const cropOn = Boolean(vp.crop && !vp.crop.off);
  const deg = (r) => Math.round((r * 180) / Math.PI);
  const camText = vp.cam ? `из 3D · азимут ${deg(vp.cam.yaw)}°, наклон ${deg(vp.cam.pitch)}°${vp.cam.roof ? ', с крышей' : ''}` : 'аксонометрия по умолчанию';
  panel.innerHTML = `
    <h2 id="vpPropsTitle">${escapeHtml(desc?.name || 'Вид удалён')}</h2>
    <p class="subtitle" id="vpPropsSub">Лист ${escapeHtml(hit.sheet.no)}, вид ${escapeHtml(no)} — ${escapeHtml(hit.sheet.name)}</p>
    <div class="prop-block" id="vpProps">
      <div class="prop-row"><span>Масштаб</span><strong id="vpScaleVal">1:${vp.scale}</strong></div>
      <div class="elev-scale" id="vpScale" role="radiogroup" aria-label="Масштаб вида на листе">
        ${scales.map((s) => `<button type="button" role="radio" data-vp-scale="${s}" aria-checked="${s === vp.scale}"${s === vp.scale ? ' class="active"' : ''}>1:${s}</button>`).join('')}
      </div>
      <label class="prop-field"><span>Номер вида</span><input id="vpNo" type="text" value="${escapeHtml(vp.no || '')}" placeholder="${escapeHtml(no)} — по порядку" maxlength="8"></label>
      <label class="prop-field"><span>Подпись</span><input id="vpTitle" type="text" value="${escapeHtml(vp.title || '')}" placeholder="${escapeHtml(desc?.name || '')}" maxlength="80"></label>
      ${prow('Маркер', `${escapeHtml(no)} / Л${escapeHtml(hit.sheet.no)}`, 'vpMarker')}
      ${prow('Центр на листе, мм', `${Math.round(vp.x)} × ${Math.round(vp.y)}`, 'vpPos')}
    </div>
    <h3>Обрезка</h3>
    <div class="prop-block" id="vpCropBlock">
      <label class="check-row"><input type="checkbox" id="vpCrop" ${cropOn ? 'checked' : ''}><span>Обрезать вид</span></label>
      ${cropOn ? prow('Рамка, мм модели', `${Math.round(vp.crop.x1 - vp.crop.x0)} × ${Math.round(vp.crop.y1 - vp.crop.y0)}`, 'vpCropSize') : ''}
      <button type="button" id="vpCropReset" ${vp.crop ? '' : 'disabled'}>Сбросить обрезку</button>
      <p class="hint">Тяните ручки рамки выбранного вида: край — с шагом 5 мм (вблизи 1 мм), Shift — свободно. Вид на листе не сдвигается.</p>
    </div>
    ${desc?.kind === '3d' ? `
    <h3>Камера</h3>
    <div class="prop-block" id="vpCamBlock">
      ${prow('Камера', escapeHtml(camText), 'vpCamText')}
      <button type="button" id="vpCam" title="Взять углы и крышу из окна 3D-вида">Обновить из 3D</button>
      ${vp.cam ? '<button type="button" class="link" id="vpCamReset">Аксонометрия по умолчанию</button>' : ''}
    </div>` : ''}
    <div class="prop-actions">
      <button type="button" id="vpOpen" title="Или двойной клик по виду на листе; Esc — назад к листу">Открыть вид</button>
      <button type="button" class="danger" id="vpRemove">Убрать с листа</button>
    </div>
    <p class="hint">Тяните вид — сдвиг (шаг 5 мм, Shift — свободно). Двойной клик — открыть вид. Delete — убрать, Ctrl+Z — вернуть. Esc — снять выбор.</p>`;
  panel.querySelectorAll('[data-vp-scale]').forEach((b) => b.addEventListener('click', () => setSelectedViewportScale(Number(b.dataset.vpScale))));
  panel.querySelector('#vpTitle').addEventListener('change', (e) => setSelectedViewportTitle(e.target.value));
  panel.querySelector('#vpNo').addEventListener('change', (e) => { if (!setSelectedViewportNo(e.target.value)) e.target.value = vp.no || ''; });
  panel.querySelector('#vpCrop').addEventListener('change', (e) => setSelectedViewportCrop(e.target.checked));
  panel.querySelector('#vpCropReset').addEventListener('click', () => resetSelectedViewportCrop());
  panel.querySelector('#vpCam')?.addEventListener('click', () => setSelectedViewportCam(camera3dSnapshot()));
  panel.querySelector('#vpCamReset')?.addEventListener('click', () => setSelectedViewportCam(null));
  panel.querySelector('#vpOpen').addEventListener('click', () => openViewFromSheet(vp.viewId));
  panel.querySelector('#vpRemove').addEventListener('click', () => removeSelectedViewport());
  return true;
}

// Листы альбома A3 (ui/sheet.js), как «Листы» в диспетчере Revit.
// Вкладка «Листы» правой панели — список листов (генплан, разрезы участка,
// этажи): клик — выбрать (в «Свойствах» — настройки листа), двойной клик или
// «Открыть» — открыть лист на холсте (ui/sheet-view.js). Выгрузка PDF/PNG —
// те же команды, что в меню «Экспорт».

import { escapeHtml } from './dom.js';
import { handleExport } from './files.js';
import { setSheetStylePref, sheetStylePref } from './landscape-style.js';
import { SHEET, sheetKey, sheetPlan, sheetTitle } from './sheet.js';
import {
  closeSheet, downloadSheetPng, findSheet, notifyViewChange, openSheet, sheetScaleOf,
} from './sheet-view.js';
import { state } from './state.js';

const CONTENTS = {
  site: 'Генплан, таблица участка, условные обозначения',
  sections: 'Разрезы участка',
  level: 'План этажа и экспликация помещений',
};

export function renderSheetsPanel(panel) {
  const specs = sheetPlan(state.project);
  if (state.sheetSel && !findSheet(state.sheetSel, specs)) state.sheetSel = null;
  const selected = state.sheetSel;
  panel.innerHTML = `
    <h2>Листы</h2>
    <p class="subtitle">Альбом A3 с рамкой и штампом. Клик — выбрать, двойной клик — открыть лист.</p>
    ${specs.length ? `
    <ol class="sheets-list" id="sheetsList" role="listbox" aria-label="Листы">
      ${specs.map((s, i) => {
    const key = sheetKey(s);
    const open = key === state.sheetOpen;
    return `<li class="sheets-item${key === selected ? ' active' : ''}${open ? ' current' : ''}" role="option" tabindex="0"
        data-sheet="${escapeHtml(key)}" aria-selected="${key === selected}">
        <span class="sheets-no">${i + 1}</span><span class="sheets-name">${escapeHtml(sheetTitle(state.project, s))}</span>
        <button type="button" class="link" data-sheet-open="${escapeHtml(key)}">${open ? 'Закрыть' : 'Открыть'}</button></li>`;
  }).join('')}
    </ol>` : `
    <p class="empty-hint" id="sheetsEmpty">Нечего печатать: добавьте комнаты на этаже или границу участка.</p>`}
    <div class="prop-actions">
      <button type="button" class="primary" id="sheetsPdfBtn" ${specs.length ? '' : 'disabled'}>Скачать PDF — все листы</button>
      <button type="button" id="sheetsPngBtn" ${specs.length ? '' : 'disabled'}>${selected ? 'PNG — выбранный лист' : `PNG — лист текущего ${state.modeName === 'plan' ? 'этажа' : 'генплана'}`}</button>
    </div>
    <h3>Оформление</h3>
    <div class="prop-block">
      <label class="check-row"><input type="checkbox" id="sheetsLsScreen" ${sheetStylePref() === 'screen' ? 'checked' : ''}><span>Генплан на листе — как на экране (иначе «Чертёж»)</span></label>
      <p class="hint">Разрезы на лист отмечаются в режиме «Ландшафт» (сводка → «Разрезы»). Ландшафт под планом этажа на лист не выводится.</p>
    </div>`;
  panel.querySelectorAll('[data-sheet]').forEach((li) => {
    const key = li.dataset.sheet;
    li.addEventListener('click', (e) => {
      if (e.target.closest('[data-sheet-open]') || state.sheetSel === key) return;
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
      if (e.target.closest('[data-sheet-open]')) return;
      openSheet(key);
    });
    li.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target === li) { e.preventDefault(); openSheet(key); }
    });
  });
  panel.querySelectorAll('[data-sheet-open]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.sheetOpen === state.sheetOpen) closeSheet();
    else openSheet(b.dataset.sheetOpen);
  }));
  panel.querySelector('#sheetsPdfBtn')?.addEventListener('click', () => handleExport('sheet-pdf'));
  panel.querySelector('#sheetsPngBtn')?.addEventListener('click', () => {
    if (state.sheetSel) downloadSheetPng(state.sheetSel);
    else handleExport('sheet-png');
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
    <p class="hint">Масштаб и раскладка — автоматически по чертежу; размещение видов на листе — в следующем шаге.</p>
    ${open ? '' : '<button type="button" class="link" id="sheetPropBack">← Свойства вида</button>'}`;
  panel.querySelector('#sheetPropOpen').addEventListener('click', () => (open ? closeSheet() : openSheet(key)));
  panel.querySelector('#sheetPropPng').addEventListener('click', () => downloadSheetPng(key));
  panel.querySelector('#sheetPropPdf').addEventListener('click', () => handleExport('sheet-pdf'));
  panel.querySelector('#sheetPropLsScreen')?.addEventListener('change', (e) => {
    setSheetStylePref(e.target.checked ? 'screen' : 'drawing');
    notifyViewChange();
  });
  panel.querySelector('#sheetPropBack')?.addEventListener('click', () => { state.sheetSel = null; notifyViewChange(); });
  return true;
}

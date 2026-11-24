// Вкладка «ТЭП» правой панели: сверху — ряд из двух значков-подвкладок
// (как ряд вкладок панели, подсказка .ptab-tip): «Экспликация помещений»
// (таблица по этажам, core/schedule.js) и «ТЭП» (помещения, площадь этажа и
// всего, показатели core/tep.js). Подвкладка — state.tepTab, помнится между
// перерисовками. Замечания по нормам — в «⚠» (ui/issues.js).

import { levelProject } from '../core/model.js';
import { totalAreaM2 } from '../core/rooms.js';
import { roomSchedule, scheduleTotals } from '../core/schedule.js';
import { tepReport, tepRows } from '../core/tep.js';
import { escapeHtml } from './dom.js';
import { activeViewId, openView } from './props-views.js';
import { state } from './state.js';
import { selectObject } from './tools.js';
import { closeSheets, isPhone } from './mobile.js';
import { showPlanRect } from './view.js';

const fmt = (v, d = 1) => v.toFixed(d).replace('.', ',');
const row = (k, v) => `<div class="prop-row"><span>${k}</span><strong>${v}</strong></div>`;
const roomQueries = new WeakMap();
const searchText = (v) => v.toLocaleLowerCase('ru').replaceAll('ё', 'е');
const numberedFloor = /(?:^|\s)(?:(-?\d+)(?:-й)?\s+этаж|этаж\s+(-?\d+))(?=\s|$)/u;

function scheduleHtml(schedule) {
  const multi = schedule.length > 1;
  const active = state.project.activeLevel;
  const levels = schedule.map(({ level, rows, totals }) => {
    const body = rows.map((r) => `<tr data-sched-room="${escapeHtml(r.id)}" data-sched-level="${escapeHtml(level.id)}" title="Показать на плане">
        <td class="num">${r.number}</td>
        <td><button type="button" class="sched-go" aria-label="${escapeHtml(`Показать на плане: ${r.name}, ${r.number}, ${level.name}`)}">${r.parent ? '↳ ' : ''}${escapeHtml(r.name)}</button>${r.open ? ' <small>летн.</small>' : ''}</td>
        <td class="area">${fmt(r.area, 2)}</td></tr>`).join('');
    return `<tbody data-sched-group="${escapeHtml(level.name)}">${multi ? `<tr class="sched-level${level.id === active ? ' active' : ''}"><th scope="rowgroup" colspan="3">${escapeHtml(level.name)}</th></tr>` : ''}
      ${body || '<tr><td colspan="3" class="empty">нет помещений</td></tr>'}
      ${multi && rows.length ? `<tr class="sched-sub"><td></td><td>Итого по этажу</td><td class="area">${fmt(totals.total, 2)}</td></tr>` : ''}</tbody>`;
  }).join('');
  const t = scheduleTotals(schedule);
  return `<input type="search" id="schedSearch" class="furn-search" aria-label="Найти комнату на плане" placeholder="Название, номер или этаж">
    <p class="empty-hint sched-status" id="schedStatus" role="status"></p>
    <table class="sched-table" id="schedTable">
      <thead><tr><th>№</th><th>Помещение</th><th class="area">м²</th></tr></thead>
      ${levels}
      <tfoot>
        <tr><td></td><td>Общая</td><td class="area">${fmt(t.total, 2)}</td></tr>
        <tr><td></td><td>Жилая</td><td class="area">${fmt(t.living, 2)}</td></tr>
        ${t.summer > 0 ? `<tr><td></td><td>Летние</td><td class="area">${fmt(t.summer, 2)}</td></tr>` : ''}
      </tfoot></table>`;
}

function bindSchedule(panel, project) {
  const input = panel.querySelector('#schedSearch');
  if (!input) return;
  const table = panel.querySelector('#schedTable');
  const status = panel.querySelector('#schedStatus');
  const groups = Array.from(table.tBodies, (body) => ({
    body, floor: searchText(body.dataset.schedGroup).match(numberedFloor), subtotal: body.querySelector('.sched-sub'),
    rows: Array.from(body.querySelectorAll('[data-sched-room]'), (tr) => ({
      tr, text: searchText([tr.cells[0].textContent, tr.querySelector('button').textContent, body.dataset.schedGroup].join(' ')),
    })),
  }));
  function filter() {
    const query = searchText(input.value.trim());
    const floor = query.match(numberedFloor);
    const terms = query.replace(numberedFloor, ' ').split(/\s+/).filter(Boolean);
    let matches = 0;
    for (const { body, floor: level, subtotal, rows } of groups) {
      let onLevel = 0;
      const onRequestedFloor = !floor || (level && (level[1] || level[2]) === (floor[1] || floor[2]));
      for (const { tr, text } of rows) {
        tr.hidden = !onRequestedFloor || !terms.every((term) => text.includes(term));
        if (!tr.hidden) onLevel++;
      }
      body.hidden = Boolean(query) && !onLevel;
      if (subtotal) subtotal.hidden = Boolean(query);
      matches += onLevel;
    }
    table.tFoot.hidden = Boolean(query);
    table.hidden = !matches;
    status.textContent = !query ? '' : matches ? `Найдено помещений: ${matches}` : 'Помещений не найдено. Попробуйте другое название или номер.';
  }
  input.value = roomQueries.get(project) || '';
  if (input.value) filter();
  input.addEventListener('input', () => {
    roomQueries.set(project, input.value);
    filter();
  });
  table.addEventListener('click', (event) => {
    const tr = event.target.closest('[data-sched-room]');
    if (!tr) return;
    const target = `plan:${tr.dataset.schedLevel}`;
    if (state.analyticalView) document.dispatchEvent(new CustomEvent('kepler:close-analytical-view'));
    if (activeViewId() !== target) openView(target);
    else if (isPhone()) closeSheets();
    const room = state.project.rooms.find((r) => r.id === tr.dataset.schedRoom);
    if (!room) return;
    state.propsTab = 'props';
    selectObject({ type: 'room', id: room.id });
    showPlanRect(room);
    if (event.detail === 0 && !isPhone()) panel.querySelector('#roomName')?.focus({ preventScroll: true });
  });
}

const TEP_TABS = [
  {
    id: 'rooms', btn: 'tepTabRooms', label: 'Комнаты',
    tip: 'номер, название и площадь помещений по этажам',
    icon: '<path d="M4 5h16v14H4z"/><path d="M4 9h16M8 9v10"/><path d="M11 12.5h6M11 15.5h4"/>',
  },
  {
    id: 'tep', btn: 'tepTabTep', label: 'Дом и участок',
    tip: 'площади дома, застройка и показатели участка',
    icon: '<path d="M4 20V10M10 20V4M16 20v-7M21 20H3"/>',
  },
];

function tepTabsHtml(active) {
  return `<div class="tep-tabs" role="tablist" aria-label="Площади">${TEP_TABS.map((t) => `
    <button type="button" role="tab" class="ptab tep-tab${t.id === active ? ' active' : ''}" id="${t.btn}" data-tep-tab="${t.id}"
      aria-label="${t.label}" aria-selected="${t.id === active}" aria-describedby="tepTip-${t.id}"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${t.icon}</svg><span>${t.label}</span><span class="ptab-tip" role="tooltip" id="tepTip-${t.id}"><b>${t.label}</b> · ${t.tip}</span></button>`).join('')}
  </div>`;
}

export function renderTepPanel(panel) {
  const project = state.project;
  const multi = project.levels.length > 1;
  const schedule = roomSchedule(project);
  const roomsTotal = schedule.reduce((n, s) => n + s.rows.length, 0);
  if (!TEP_TABS.some((t) => t.id === state.tepTab)) state.tepTab = 'tep';
  const tab = state.tepTab;
  let body;
  if (tab === 'rooms') {
    body = `
    <h2>Экспликация помещений</h2>
    ${roomsTotal ? scheduleHtml(schedule) : '<p class="empty-hint">Добавьте первое помещение на план.</p>'}
    <p class="empty-hint">Площади внутри стен. Вложенные комнаты учтены отдельно.</p>`;
  } else {
    const allArea = project.levels.reduce((sum, l) => sum + totalAreaM2(levelProject(project, l.id)), 0);
    body = `
    <h2>Площади дома и участка</h2>
    <h3>Дом</h3>
    <div class="prop-block" id="tepHouse">
      ${row(`Помещений${multi ? ' на этаже' : ''}`, project.rooms.length)}
      ${row(multi ? 'Площадь этажа' : 'Общая площадь', `${fmt(totalAreaM2(project))} м²`)}
      ${multi ? row(`Всего (${project.levels.length} эт.)`, `${fmt(allArea)} м² · ${roomsTotal} пом.`) : ''}
    </div>
    <h3>Показатели</h3>
    <div class="prop-block" id="tepRows">${tepRows(tepReport(project)).map(([k, v]) => row(k, v)).join('')}</div>`;
  }
  panel.innerHTML = `${tepTabsHtml(tab)}${body}`;
  panel.querySelectorAll('[data-tep-tab]').forEach((b) => b.addEventListener('click', () => {
    if (state.tepTab === b.dataset.tepTab) return;
    state.tepTab = b.dataset.tepTab;
    renderTepPanel(panel);
    panel.querySelector(`[data-tep-tab="${state.tepTab}"]`)?.focus();
  }));
  if (tab === 'rooms') bindSchedule(panel, project);
}

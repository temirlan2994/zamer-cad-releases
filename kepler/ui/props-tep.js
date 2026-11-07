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
import { switchLevel } from './levels.js';
import { state } from './state.js';
import { selectObject } from './tools.js';

const fmt = (v, d = 1) => v.toFixed(d).replace('.', ',');
const row = (k, v) => `<div class="prop-row"><span>${k}</span><strong>${v}</strong></div>`;

function scheduleHtml(schedule) {
  const multi = schedule.length > 1;
  const active = state.project.activeLevel;
  const levels = schedule.map(({ level, rows, totals }) => {
    const body = rows.map((r) => `<tr data-sched-room="${r.id}" data-sched-level="${level.id}" tabindex="0" title="Показать на плане">
        <td class="num">${r.number}</td>
        <td>${r.parent ? '↳ ' : ''}${escapeHtml(r.name)}${r.open ? ' <small>летн.</small>' : ''}</td>
        <td class="area">${fmt(r.area, 2)}</td></tr>`).join('');
    return `${multi ? `<tr class="sched-level${level.id === active ? ' active' : ''}"><th colspan="3">${escapeHtml(level.name)}</th></tr>` : ''}
      ${body || '<tr><td colspan="3" class="empty">нет помещений</td></tr>'}
      ${multi && rows.length ? `<tr class="sched-sub"><td></td><td>Итого по этажу</td><td class="area">${fmt(totals.total, 2)}</td></tr>` : ''}`;
  }).join('');
  const t = scheduleTotals(schedule);
  return `<table class="sched-table" id="schedTable">
      <thead><tr><th>№</th><th>Помещение</th><th class="area">м²</th></tr></thead>
      <tbody>${levels}</tbody>
      <tfoot>
        <tr><td></td><td>Общая</td><td class="area">${fmt(t.total, 2)}</td></tr>
        <tr><td></td><td>Жилая</td><td class="area">${fmt(t.living, 2)}</td></tr>
        ${t.summer > 0 ? `<tr><td></td><td>Летние</td><td class="area">${fmt(t.summer, 2)}</td></tr>` : ''}
      </tfoot></table>`;
}

const TEP_TABS = [
  {
    id: 'rooms', btn: 'tepTabRooms', label: 'Экспликация помещений',
    tip: 'номер, название и площадь помещений по этажам',
    icon: '<path d="M4 5h16v14H4z"/><path d="M4 9h16M8 9v10"/><path d="M11 12.5h6M11 15.5h4"/>',
  },
  {
    id: 'tep', btn: 'tepTabTep', label: 'ТЭП',
    tip: 'площади дома, застройка и показатели участка',
    icon: '<path d="M4 20V10M10 20V4M16 20v-7M21 20H3"/>',
  },
];

function tepTabsHtml(active) {
  return `<div class="tep-tabs" role="tablist" aria-label="ТЭП и экспликация">${TEP_TABS.map((t) => `
    <button type="button" role="tab" class="ptab tep-tab${t.id === active ? ' active' : ''}" id="${t.btn}" data-tep-tab="${t.id}"
      aria-label="${t.label}" aria-selected="${t.id === active}" aria-describedby="tepTip-${t.id}"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${t.icon}</svg><span class="ptab-tip" role="tooltip" id="tepTip-${t.id}"><b>${t.label}</b> · ${t.tip}</span></button>`).join('')}
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
    ${roomsTotal ? scheduleHtml(schedule) : '<p class="empty-hint">Помещений пока нет — таблица заполнится сама.</p>'}
    <p class="empty-hint">Площади — чистые, вложенные помещения отнимают площадь у родителя. Выгрузка — «Экспорт ▾ → Экспликация (CSV)».</p>`;
  } else {
    const allArea = project.levels.reduce((sum, l) => sum + totalAreaM2(levelProject(project, l.id)), 0);
    body = `
    <h2>ТЭП</h2>
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
  panel.querySelectorAll('[data-sched-room]').forEach((tr) => {
    const go = () => {
      if (state.modeName !== 'plan') return;
      if (tr.dataset.schedLevel !== project.activeLevel) switchLevel(tr.dataset.schedLevel);
      selectObject({ type: 'room', id: tr.dataset.schedRoom });
    };
    tr.addEventListener('click', go);
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
  });
}

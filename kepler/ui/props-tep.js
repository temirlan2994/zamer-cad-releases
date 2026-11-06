// Вкладка «ТЭП и площади» панели «Свойства»: показатели дома (помещения,
// площадь этажа и всего), ТЭП (core/tep.js) и экспликация помещений по
// этажам (core/schedule.js). Замечания по нормам — в «⚠» на холсте
// (ui/issues.js).

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

export function renderTepPanel(panel) {
  const project = state.project;
  const multi = project.levels.length > 1;
  const allArea = project.levels.reduce((sum, l) => sum + totalAreaM2(levelProject(project, l.id)), 0);
  const schedule = roomSchedule(project);
  const roomsTotal = schedule.reduce((n, s) => n + s.rows.length, 0);
  panel.innerHTML = `
    <h2>ТЭП и площади</h2>
    <h3>Дом</h3>
    <div class="prop-block" id="tepHouse">
      ${row(`Помещений${multi ? ' на этаже' : ''}`, project.rooms.length)}
      ${row(multi ? 'Площадь этажа' : 'Общая площадь', `${fmt(totalAreaM2(project))} м²`)}
      ${multi ? row(`Всего (${project.levels.length} эт.)`, `${fmt(allArea)} м² · ${roomsTotal} пом.`) : ''}
    </div>
    <h3>ТЭП</h3>
    <div class="prop-block" id="tepRows">${tepRows(tepReport(project)).map(([k, v]) => row(k, v)).join('')}</div>
    <h3>Экспликация помещений</h3>
    ${roomsTotal ? scheduleHtml(schedule) : '<p class="empty-hint">Помещений пока нет — таблица заполнится сама.</p>'}
    <p class="empty-hint">Площади — чистые, вложенные помещения отнимают площадь у родителя. Выгрузка — «Экспорт ▾ → Экспликация (CSV)».</p>`;
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

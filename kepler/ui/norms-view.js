// Панель «Нормы»: инсоляция жилых комнат и проверки СП 55 — сводка в
// свойствах проекта и блок в свойствах комнаты. Отчёт считается в store
// (state.norms) после каждого изменения.

import { formatDuration } from '../core/insolation.js';
import { escapeHtml } from './dom.js';
import { switchLevel } from './levels.js';
import { state } from './state.js';
import { selectObject } from './tools.js';

const fmtDay = (day) => day.split('-').reverse().join('.');
const mark = (ok) => (ok ? '✓' : '✗');

function sunLine(r, hours) {
  if (!r.windows) return 'нет окон';
  return `${formatDuration(r.longest)} подряд${r.total > r.longest ? `, всего ${formatDuration(r.total)}` : ''}${r.living ? ` (норма ${String(hours).replace('.', ',')} ч)` : ''}`;
}

// Сводка для свойств проекта.
export function normsSection() {
  const report = state.norms;
  if (!report) return '';
  const ins = report.insolation;
  const living = ins.rooms.filter((r) => r.living);
  const issues = report.problems.length + (ins.ok ? 0 : 1);
  const rows = living.map((r) => `
      <li class="${r.meets ? 'ok' : 'bad'}"><button class="link" data-norm-room="${r.id}" data-level="${r.levelId}">${mark(r.meets)} ${escapeHtml(r.name)}</button>
        <span>${r.windows ? formatDuration(r.longest) : 'нет окон'}</span></li>`).join('');
  const verdict = !ins.need
    ? 'жилых комнат нет'
    : `${ins.met} из ${ins.need} нужных ${ins.ok ? '— норма выполнена' : '— не хватает'}`;
  const problems = report.problems.map((p) => `
      <li class="bad"><button class="link" data-norm-room="${p.room.id}" data-level="${p.room.levelId}">${escapeHtml(p.room.name)}</button>
        <span>${escapeHtml(p.text)}</span></li>`).join('');
  return `
    <h3>Нормы <span class="badge ${issues ? 'warn' : 'ok'}">${issues ? `замечаний: ${issues}` : 'в порядке'}</span></h3>
    <div class="prop-block norms">
      <div class="norm-head">☀ Инсоляция — ${ins.norm.zone} зона: ${String(ins.norm.hours).replace('.', ',')} ч на ${fmtDay(ins.norm.day)}. ${verdict}</div>
      ${rows ? `<ul class="norm-list">${rows}</ul>` : ''}
      ${problems ? `<div class="norm-head">Площади, ширины, свет, высота</div><ul class="norm-list">${problems}</ul>` : '<p class="empty-hint">Площади, ширины, свет 1:8 и высота — в норме.</p>'}
      <p class="empty-hint">Ориентир: СанПиН 1.2.3685-21 (инсоляция), СП 55.13330 (дома одноквартирные). Подсказка для концепции, не экспертиза.</p>
    </div>`;
}

// Блок в свойствах комнаты.
export function roomNormsBlock(roomId) {
  const report = state.norms;
  if (!report) return '';
  const ins = report.insolation.rooms.find((r) => r.id === roomId);
  const checks = report.rooms.find((r) => r.id === roomId)?.checks || [];
  if (!checks.length && !(ins && (ins.living || ins.windows))) return '';
  const items = [];
  if (ins && (ins.living || ins.windows)) {
    items.push(`<li class="${!ins.living || ins.meets ? 'ok' : 'bad'}"><span>${ins.living ? mark(ins.meets) : '☀'} Инсоляция: ${sunLine(ins, report.insolation.norm.hours)}</span></li>`);
  }
  for (const c of checks) items.push(`<li class="${c.ok ? 'ok' : 'bad'}"><span>${mark(c.ok)} ${escapeHtml(c.text)}</span></li>`);
  return `<h3>Нормы</h3><div class="prop-block norms"><ul class="norm-list single">${items.join('')}</ul></div>`;
}

// Клик по комнате в сводке: переключить этаж и выделить комнату.
export function bindNormLinks(panel) {
  panel.querySelectorAll('[data-norm-room]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.level !== state.project.activeLevel) switchLevel(btn.dataset.level);
      selectObject({ type: 'room', id: btn.dataset.normRoom });
    });
  });
}

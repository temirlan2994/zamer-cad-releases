// Экспликация помещений: номера, площади, итоги по этажам. Чистый модуль.
//
// Площадь — чистая (как в панели «Состав»: вложенные помещения отнимают
// площадь у родителя). Итоги по общепринятым понятиям:
//   общая — все помещения, кроме летних (террасы, балконы);
//   жилая — гостиные, спальни, кабинеты;
//   летние — террасы и балконы (отдельной строкой).

import { isOpenRoom } from './catalog.js';
import { levelProject, roomCeiling, sortedLevels } from './model.js';
import { roomNetAreaM2 } from './rooms.js';

export const LIVING_TYPES = new Set(['living', 'bedroom', 'master-bedroom', 'cabinet']);

// Строки экспликации по этажам снизу вверх. Номера «этаж.порядок» (1.01…)
// в порядке чтения плана: сверху вниз, слева направо.
export function roomSchedule(project) {
  return sortedLevels(project).map((level, li) => {
    const lp = levelProject(project, level.id);
    const rooms = [...lp.rooms].sort((a, b) => (Math.abs(a.y - b.y) > 300 ? a.y - b.y : a.x - b.x));
    const rows = rooms.map((room, i) => ({
      id: room.id,
      number: `${li + 1}.${String(i + 1).padStart(2, '0')}`,
      name: room.name,
      type: room.type,
      area: roomNetAreaM2(lp, room),
      w: room.w,
      h: room.h,
      ceiling: roomCeiling(room, level),
      living: LIVING_TYPES.has(room.type),
      open: isOpenRoom(room),
      parent: room.parentId ? lp.rooms.find((r) => r.id === room.parentId)?.name || null : null,
    }));
    return { level, rows, totals: totalsOf(rows) };
  });
}

function totalsOf(rows) {
  const sum = (pred) => rows.filter(pred).reduce((s, r) => s + r.area, 0);
  return {
    total: sum((r) => !r.open),
    living: sum((r) => r.living),
    summer: sum((r) => r.open),
  };
}

export function scheduleTotals(schedule) {
  return totalsOf(schedule.flatMap((s) => s.rows));
}

// CSV для Excel в русской локали: разделитель «;», десятичная запятая,
// UTF-8 с BOM (иначе кириллица откроется кракозябрами).
export function buildRoomScheduleCsv(project) {
  const schedule = roomSchedule(project);
  const num = (v, d = 2) => v.toFixed(d).replace('.', ',');
  const cell = (v) => {
    const s = String(v ?? '');
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [['Этаж', '№', 'Помещение', 'Площадь, м²', 'Ширина, м', 'Длина, м', 'Высота, м', 'Жилое', 'Внутри помещения'].join(';')];
  for (const { level, rows, totals } of schedule) {
    for (const r of rows) {
      lines.push([
        cell(level.name), r.number, cell(r.name), num(r.area), num(r.w / 1000), num(r.h / 1000),
        num(r.ceiling / 1000), r.living ? 'да' : '', cell(r.parent || ''),
      ].join(';'));
    }
    lines.push([cell(level.name), '', 'Итого по этажу (общая)', num(totals.total), '', '', '', '', ''].join(';'));
  }
  const all = scheduleTotals(schedule);
  lines.push(['', '', 'Общая площадь', num(all.total), '', '', '', '', ''].join(';'));
  lines.push(['', '', 'Жилая площадь', num(all.living), '', '', '', '', ''].join(';'));
  if (all.summer > 0) lines.push(['', '', 'Летние помещения (терраса, балкон)', num(all.summer), '', '', '', '', ''].join(';'));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

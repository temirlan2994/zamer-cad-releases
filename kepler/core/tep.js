// Технико-экономические показатели (ТЭП) дома и участка. Чистый модуль.
//
// Площадь застройки — пятно нижнего этажа с наружными стенами (без террас).
// Коэффициент застройки — площадь застройки / площадь участка; коэффициент
// плотности — сумма площадей этажей по наружному контуру / площадь участка.
// Строительный объём надземной части — Σ пятно этажа × высота этажа.

import { levelProject, sortedLevels } from './model.js';
import { buildingFootprintM2 } from './rooms.js';
import { roomSchedule, scheduleTotals } from './schedule.js';
import { polygonAreaM2 } from './site.js';

export function tepReport(project) {
  const levels = sortedLevels(project);
  const footprints = levels.map((l) => buildingFootprintM2(levelProject(project, l.id)));
  const plot = project.site?.boundary?.length >= 3 ? polygonAreaM2(project.site.boundary) : null;
  const totals = scheduleTotals(roomSchedule(project));
  const floorArea = footprints.reduce((s, a) => s + a, 0);
  return {
    plot,
    footprint: footprints[0] || 0,
    coverage: plot ? (footprints[0] || 0) / plot : null,
    density: plot ? floorArea / plot : null,
    floorArea,
    total: totals.total,
    living: totals.living,
    summer: totals.summer,
    volume: levels.reduce((s, l, i) => s + footprints[i] * (l.height / 1000), 0),
    storeys: levels.filter((l, i) => footprints[i] > 0).length || levels.length,
    height: Math.max(...levels.map((l) => l.elevation + l.height)) / 1000,
  };
}

const fmt = (v, d = 1) => v.toFixed(d).replace('.', ',');

// Строки для таблиц: [название, значение].
export function tepRows(t) {
  const rows = [];
  if (t.plot) rows.push(['Площадь участка', `${fmt(t.plot)} м²`]);
  rows.push(['Площадь застройки', `${fmt(t.footprint)} м²`]);
  if (t.coverage !== null) rows.push(['Коэффициент застройки', `${fmt(t.coverage * 100)} %`]);
  if (t.density !== null) rows.push(['Коэффициент плотности', fmt(t.density, 2)]);
  rows.push(['Общая площадь дома', `${fmt(t.total)} м²`]);
  rows.push(['Жилая площадь', `${fmt(t.living)} м²`]);
  if (t.summer > 0) rows.push(['Летние помещения', `${fmt(t.summer)} м²`]);
  rows.push(['Строительный объём', `${fmt(t.volume, 0)} м³`]);
  rows.push(['Этажность / высота', `${t.storeys} · ${fmt(t.height, 2)} м`]);
  return rows;
}

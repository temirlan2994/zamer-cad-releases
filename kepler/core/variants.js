// Варианты планировки внутри проекта и их сравнение. Чистый модуль.
//
// Вариант хранит только дом: этажи (комнаты, проёмы, мебель), оси дома и
// настройки. Участок общий — он не копируется (в нём может лежать тяжёлая
// картинка топосъёмки), поэтому варианты сравниваются на одном участке.

import { makeId, normalizeProject } from './model.js';
import { normsReport } from './norms.js';
import { tepReport } from './tep.js';

const clone = (v) => JSON.parse(JSON.stringify(v));

export function snapshotHouse(project) {
  return clone({
    levels: project.levels,
    activeLevel: project.activeLevel,
    building: project.building,
    settings: project.settings,
  });
}

export function createVariant(project, name, house = snapshotHouse(project)) {
  return { id: makeId('variant'), name, createdAt: new Date().toISOString(), house };
}

// Тот же проект (участок, имя, варианты), но с домом из варианта.
export function projectWithHouse(project, house) {
  const base = JSON.parse(JSON.stringify(project));
  return normalizeProject({ ...base, ...clone(house) });
}

// Следующее свободное имя «Вариант A», «Вариант B»…
export function nextVariantName(variants) {
  const used = new Set((variants || []).map((v) => v.name));
  for (let i = 0; i < 26; i += 1) {
    const name = `Вариант ${String.fromCharCode(65 + i)}`;
    if (!used.has(name)) return name;
  }
  return `Вариант ${(variants?.length || 0) + 1}`;
}

// Сводка для сравнения: показатели, нормы, инсоляция.
export function variantSummary(project) {
  const tep = tepReport(project);
  const norms = normsReport(project);
  return {
    rooms: project.levels.reduce((s, l) => s + l.rooms.length, 0),
    storeys: tep.storeys,
    total: tep.total,
    living: tep.living,
    footprint: tep.footprint,
    coverage: tep.coverage,
    volume: tep.volume,
    problems: norms.problems.length,
    insolationOk: norms.insolation.ok,
    insolationMet: `${norms.insolation.met}, нужно ${norms.insolation.need}`,
  };
}

const fmt = (v, d = 1) => (v === null || v === undefined ? '—' : v.toFixed(d).replace('.', ','));

// Строки таблицы сравнения: [показатель, A, B, разница].
export function compareRows(a, b) {
  const num = (label, key, unit, d = 1) => {
    const va = a[key];
    const vb = b[key];
    const delta = va !== null && vb !== null && va !== undefined && vb !== undefined ? vb - va : null;
    const sign = delta > 0 ? '+' : '';
    return [label, `${fmt(va, d)} ${unit}`.trim(), `${fmt(vb, d)} ${unit}`.trim(), delta === null || Math.abs(delta) < 1e-9 ? '' : `${sign}${fmt(delta, d)}`];
  };
  return [
    num('Общая площадь', 'total', 'м²'),
    num('Жилая площадь', 'living', 'м²'),
    num('Площадь застройки', 'footprint', 'м²'),
    ['Коэффициент застройки', a.coverage === null ? '—' : `${fmt(a.coverage * 100)} %`, b.coverage === null ? '—' : `${fmt(b.coverage * 100)} %`, ''],
    num('Строительный объём', 'volume', 'м³', 0),
    num('Помещений', 'rooms', '', 0),
    ['Инсоляция (жилые)', `${a.insolationOk ? '✓' : '✗'} ${a.insolationMet}`, `${b.insolationOk ? '✓' : '✗'} ${b.insolationMet}`, ''],
    num('Замечаний по нормам', 'problems', '', 0),
  ];
}

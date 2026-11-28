import { COST_CATEGORIES, normalizeBudget } from './concept-data.js';
import { buildHouseMesh } from './mesh3d.js';
import { levelProject, sortedLevels } from './model.js';
import { levelWindowOpenings } from './spanning-windows.js';
import { openingHeight } from './opening-preset.js';
import { tepReport } from './tep.js';

const round = (n) => Math.round(n * 100) / 100;
const cross = (a, b) => ({ x: a.y*b.z-a.z*b.y, y: a.z*b.x-a.x*b.z, z: a.x*b.y-a.y*b.x });
const dot = (a, b) => a.x*b.x+a.y*b.y+a.z*b.z;
export function faceArea(face) {
  if (!face?.pts?.length) return 0;
  const vector = { x: 0, y: 0, z: 0 };
  face.pts.forEach((p, i) => {
    const c = cross(p, face.pts[(i+1)%face.pts.length]);
    vector.x += c.x; vector.y += c.y; vector.z += c.z;
  });
  return Math.hypot(vector.x, vector.y, vector.z) / 2;
}
function volume(faces) {
  return Math.abs(faces.reduce((sum, f) => {
    const length = Math.hypot(f.normal.x, f.normal.y, f.normal.z);
    return length ? sum + faceArea(f)*dot(f.normal, f.pts[0])/length/3 : sum;
  }, 0)) / 1e9;
}

export function conceptQuantities(project) {
  const tep = tepReport(project);
  const mesh = buildHouseMesh(project, { roof: true, site: false, landscape: false, furniture: false, facades: false });
  const windows = [], doors = new Set();
  for (const level of sortedLevels(project)) {
    for (const opening of levelWindowOpenings(levelProject(project, level.id))) {
      if (opening.orphan) continue;
      if (opening.kind === 'window') windows.push(opening.width*openingHeight(opening, level)/1e6);
      if (opening.kind === 'door' && opening.type !== 'none') doors.add(`${level.id}/${opening.id}/${opening.assemblyPart || ''}`);
    }
  }
  const foundation = mesh.filter((face) => face.kind === 'foundation');
  const hasHouse = tep.footprint > 0;
  return {
    foundation: !hasHouse || project.envelope?.foundation?.enabled === false ? 0 : foundation.length ? volume(foundation) : null,
    walls: volume(mesh.filter((face) => face.kind === 'wall')),
    slabs: volume(mesh.filter((face) => face.kind === 'slab')),
    roof: mesh.filter((face) => face.kind === 'roof' && face.normal.z > 0).reduce((sum, face) => sum+faceArea(face)/1e6, 0),
    glazing: windows.reduce((sum, area) => sum+area, 0), doors: doors.size,
    finish: tep.total, engineering: tep.total,
    landscape: project.site?.landscape?.objects?.length ? 1 : 0,
  };
}

export function estimateConceptBudget(project, { quantities = conceptQuantities(project) } = {}) {
  const config = normalizeBudget(project.concept?.budget);
  const rows = COST_CATEGORIES.map(([id, title, unit]) => {
    const quantity = Number.isFinite(quantities[id]) ? Math.max(0, quantities[id]) : null;
    const rate = config.rates[id];
    const included = quantity == null || quantity > 1e-6;
    return { id, title, unit, quantity, rate, included,
      total: quantity != null && rate != null ? round(quantity*rate) : null,
      status: !included ? 'not_required' : quantity == null ? 'unknown_quantity' : rate == null ? 'unpriced' : 'priced' };
  });
  const required = rows.filter((row) => row.included);
  const missing = required.filter((row) => row.status !== 'priced');
  const provenance = [!config.region && 'регион', !config.date && 'дата цен', !config.source && 'источник расценок'].filter(Boolean);
  const subtotal = round(rows.reduce((sum, row) => sum+(row.total || 0), 0));
  const complete = required.length > 0 && !missing.length && !provenance.length;
  const low = round(subtotal*(1-config.lowPercent/100)), high = round(subtotal*(1+config.highPercent/100));
  return { config, rows, subtotal, low, high, complete, missing: missing.map((row) => row.id), provenance,
    pricedCount: required.length-missing.length, requiredCount: required.length,
    targetStatus: config.target == null ? 'unset' : !complete ? 'unknown' : high > config.target ? 'over' : 'within',
    limitations: ['Предварительная стоимость по геометрическим объёмам и введённым расценкам.',
      'Расценки должны включать выбранный состав материалов и работ; неполные позиции не считаются нулевыми.',
      'Отделка и инженерия оценены по площади помещений, благоустройство — одной введённой суммой.',
      'Объёмы геометрические: армирование, потери, доставка, грунты и налоги учитываются в расценках или диапазоне отдельно.'],
  };
}

const csvCell = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
export function budgetCsv(report) {
  return '\uFEFF' + [
    ['Регион', report.config.region, 'Валюта', report.config.currency, 'Дата цен', report.config.date],
    ['Источник', report.config.source], ['Раздел', 'Количество', 'Ед.', 'Расценка', 'Стоимость', 'Состояние'],
    ...report.rows.filter((row) => row.included).map((row) => [row.title, row.quantity == null ? '' : round(row.quantity), row.unit, row.rate, row.total, row.status]),
    [report.complete ? 'Итого' : 'Подытог известных позиций', report.subtotal], ['Диапазон известных позиций', report.low, report.high],
    ['Не хватает исходных данных', report.provenance.join(', ')], ['Примечание', report.limitations.join(' ')],
  ].map((row) => row.map(csvCell).join(';')).join('\r\n');
}

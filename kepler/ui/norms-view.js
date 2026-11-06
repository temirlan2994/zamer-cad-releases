// Таблица ТЭП в свойствах проекта. Замечания по нормам (инсоляция, СП 55,
// проходы у мебели, перекрытия) — в панели «⚠» на холсте (ui/issues.js).

import { tepReport, tepRows } from '../core/tep.js';
import { state } from './state.js';

export function tepSection() {
  const rows = tepRows(tepReport(state.project));
  return `<h3>ТЭП</h3><div class="prop-block">${rows.map(([k, v]) => `
      <div class="prop-row"><span>${k}</span><strong>${v}</strong></div>`).join('')}
    </div>`;
}

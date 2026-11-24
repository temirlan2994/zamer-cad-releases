import { escapeHtml } from './dom.js';
import { closeSheets } from './mobile.js';
import { closeAnalyticalView, openHomeMission } from './project-route.js';
import { ergoPref, setErgoPref } from './render-ergonomics.js';
import { setSolarMode } from './solar-analysis.js';
import { state } from './state.js';

// Переходим в тот же конкретный раздел, который открывается из палитры.
const destinations = {
  layout: [
    ['flows', 'zones', 'Состав зон'],
    ['flows', 'scenarios', 'Сценарии семьи'],
    ['flows', 'routes', 'Связи между помещениями'],
  ],
  circulation: [
    ['circulation', 'circulation-check', 'Ширина прохода'],
    ['circulation', 'circulation-routes', 'Маршруты'],
    ['circulation', 'circulation-map', 'Нагрузка на проходы'],
  ],
  engineering: [
    ['engineering', 'engineering-connections', 'Точки подключения'],
    ['engineering', 'engineering-wet', 'Мокрые зоны'],
    ['engineering', 'engineering-vertical', 'Совмещение этажей'],
  ],
  light: [['climate', 'location', 'Дата, координаты и север']],
};

export function renderAnalyticalProps(panel, view) {
  const level = state.project.levels.find((entry) => String(entry.id) === view.levelId);
  const rooms = level.rooms.filter((room) => room.type !== 'shaft');
  const actions = destinations[view.analysis] || [];
  const light = view.analysis === 'light';
  const ergo = view.analysis === 'ergonomics' ? ergoPref() : null;
  panel.innerHTML = `
    <h2 id="viewPropsTitle">Вид: ${escapeHtml(view.title)}</h2>
    <div class="prop-block" data-floor-analysis="${view.analysis}">
      ${rooms.length ? '' : '<p class="hint">На этом этаже пока нет помещений.</p>'}
      ${rooms.length && !light ? `<div class="prop-row"><span>Помещений на этаже</span><strong>${rooms.length}</strong></div>` : ''}
      ${ergo && rooms.length && !level.items.length ? '<p class="hint">Добавьте мебель на план, чтобы проверить зазоры.</p>' : ''}
      ${light ? `<label class="prop-field"><span>Карта всех помещений</span>
        <select data-floor-light-mode>
          <option value="daylight"${state.solarAnalysis?.mode === 'direct' ? '' : ' selected'}>Дневная освещённость, лк</option>
          <option value="direct"${state.solarAnalysis?.mode === 'direct' ? ' selected' : ''}>Прямое солнце, ч</option>
        </select></label>` : ''}
      ${ergo ? `<label class="check-row"><input type="checkbox" data-floor-ergo="heat"${ergo.heat ? ' checked' : ''}><span>Карта проходимости</span></label>
        <label class="check-row"><input type="checkbox" data-floor-ergo="okZones"${ergo.okZones ? ' checked' : ''}><span>Показывать свободные зоны у мебели</span></label>` : ''}
      ${actions.map(([section, mission, label]) => `<button type="button" data-floor-section="${section}" data-floor-mission="${mission}">${label}</button>`).join('')}
      ${!rooms.length ? '<button type="button" data-floor-plan>Перейти на план этажа</button>' : ''}
    </div>`;
  for (const btn of panel.querySelectorAll('[data-floor-mission]')) {
    btn.addEventListener('click', () => openHomeMission(btn.dataset.floorSection, btn.dataset.floorMission, btn));
  }
  panel.querySelector('[data-floor-light-mode]')?.addEventListener('change', (event) => {
    setSolarMode(event.target.value);
    panel.querySelector('[data-floor-light-mode]')?.focus({ preventScroll: true });
  });
  for (const box of panel.querySelectorAll('[data-floor-ergo]')) {
    box.addEventListener('change', () => {
      setErgoPref({ [box.dataset.floorErgo]: box.checked });
      panel.querySelector(`[data-floor-ergo="${box.dataset.floorErgo}"]`)?.focus({ preventScroll: true });
    });
  }
  panel.querySelector('[data-floor-plan]')?.addEventListener('click', () => {
    closeAnalyticalView();
    closeSheets();
  });
}

// Связанное крыльцо редактируется отдельно от двери: удаление не затрагивает проём.
import { deriveEntrances, entranceSettings, ENTRANCE_MATERIALS } from '../core/entrance.js';
import { escapeHtml, toast } from './dom.js';
import { deleteSelection } from './plan-actions.js';
import { state } from './state.js';
import { mutate } from './store.js';
import { selectObject } from './tools.js';

const FIELDS = [
  ['width', 'Ширина, мм', 600, 12000, 50],
  ['landingDepth', 'Глубина площадки, мм', 600, 6000, 50],
  ['tread', 'Глубина ступени, мм', 200, 800, 10],
  ['maxRiser', 'Высота ступени до, мм', 80, 250, 5],
];
const KEYS = ['enabled', 'mode', 'material', 'stepCount', ...FIELDS.map(([key]) => key)];

export function renderEntranceProps(panel, openingId) {
  const opening = state.project.openings.find((o) => o.id === openingId);
  if (!opening) { panel.innerHTML = '<h2>Крыльцо</h2><p>Входная дверь удалена.</p>'; return; }
  const settings = entranceSettings(state.project, opening);
  const entry = deriveEntrances(state.project).find((e) => e.openingId === openingId);
  const width = entry?.steps?.width || entry?.landing?.width || Math.max(1200, opening.width + settings.landingExtraWidth);
  const steps = entry?.steps;
  panel.innerHTML = `<h2>Крыльцо и наружная лестница</h2>
    <p class="subtitle">Площадка следует за входной дверью. Верх — на отметке пола, низ — по рельефу.</p>
    <div class="prop-block">
      <label class="check-row"><input id="porchEnabled" type="checkbox" ${settings.enabled ? 'checked' : ''}><span>Показывать крыльцо</span></label>
      <label class="prop-field"><span>Подъём</span><select id="porchMode">${[['steps', 'Ступени'], ['ramp', 'Пандус'], ['both', 'Ступени + пандус'], ['none', 'Только площадка']].map(([id, title]) => `<option value="${id}" ${settings.mode === id ? 'selected' : ''}>${title}</option>`).join('')}</select></label>
      <div class="prop-grid porch-fields">${FIELDS.map(([key, title, min, max, step]) => `<label class="prop-field"><span>${title}</span><input data-porch-field="${key}" type="number" min="${min}" max="${max}" step="${step}" ${key === 'maxRiser' && settings.stepCount ? 'disabled' : ''} value="${key === 'width' ? settings.width || width : settings[key]}"></label>`).join('')}</div>
      <label class="check-row"><input id="porchAutoSteps" type="checkbox" ${settings.stepCount ? '' : 'checked'}><span>Количество ступеней автоматически</span></label>
      <label class="prop-field"><span>Количество ступеней</span><input id="porchStepCount" type="number" min="1" max="100" step="1" value="${settings.stepCount || steps?.count || 3}" ${settings.stepCount ? '' : 'disabled'}></label>
      <label class="prop-field"><span>Материал</span><select id="porchMaterial">${ENTRANCE_MATERIALS.map((m) => `<option value="${m.id}" ${settings.material === m.id ? 'selected' : ''}>${escapeHtml(m.title)}</option>`).join('')}</select></label>
      ${steps?.enabled ? `<p class="hint">${steps.count} ступ. · подъём ${Math.round(steps.riser)} мм · длина марша ${Math.round(steps.run)} мм</p>` : ''}
      ${entry?.status === 'pending' ? '<p class="hint">Задайте высоту пола над землёй в настройках дома, чтобы построить лестницу.</p>' : ''}
    </div>
    <div class="prop-actions"><button type="button" id="porchDoor">К двери</button><button type="button" id="porchReset">Сбросить настройки</button><button type="button" id="porchDelete">Удалить крыльцо</button></div>`;
  const set = (patch) => mutate(() => { opening.entrance = { ...opening.entrance, ...patch }; });
  panel.querySelector('#porchEnabled').addEventListener('change', (e) => set({ enabled: e.target.checked }));
  panel.querySelector('#porchMode').addEventListener('change', (e) => set({ mode: e.target.value }));
  panel.querySelector('#porchMaterial').addEventListener('change', (e) => set({ material: e.target.value }));
  panel.querySelector('#porchAutoSteps').addEventListener('change', (e) => set({ stepCount: e.target.checked ? 0 : steps?.count || 3 }));
  const number = (input, key, min, max) => input.addEventListener('change', () => {
    const value = Number(input.value);
    if (!input.value.trim() || !Number.isFinite(value) || value < min || value > max) {
      toast(`Введите значение от ${min} до ${max}`);
      renderEntranceProps(panel, openingId);
      return;
    }
    set({ [key]: Math.round(value) });
  });
  FIELDS.forEach(([key, , min, max]) => number(panel.querySelector(`[data-porch-field="${key}"]`), key, min, max));
  number(panel.querySelector('#porchStepCount'), 'stepCount', 1, 100);
  panel.querySelector('#porchDoor').addEventListener('click', () => selectObject({ type: 'opening', id: openingId }));
  panel.querySelector('#porchReset').addEventListener('click', () => mutate(() => {
    for (const key of KEYS) if (opening.entrance) delete opening.entrance[key];
  }));
  panel.querySelector('#porchDelete').addEventListener('click', deleteSelection);
}

// Вкладка «Виды» правой панели: что и как видно на плане. Поворот вида
// (те же команды, что и в панели ⟲ на колонке инструментов — ui/view-align.js),
// подложка-съёмка, наружные размеры, ландшафт под домом (ui/plan-landscape.js),
// 3D. Только вид: данные проекта меняет лишь «Развернуть оси дома по виду» и
// размеры (как кнопка «Размеры» на колонке).

import { customViewAngle, isPlanEmpty, viewAngle } from '../core/view-angles.js';
import { el, escapeHtml } from './dom.js';
import {
  PLAN_LS_GROUPS, planLandscapePref, planOnlyPref, setPlanLandscapePref,
} from './plan-landscape.js';
import { state } from './state.js';
import { requestDraw } from './view.js';
import { applyViewAngle, axesToViewCmd, resetViewAngleCmd, startAlignView } from './view-align.js';

const MODE_TITLES = { plan: '«План»', site: '«Участок»', landscape: '«Ландшафт»' };
const fmtAngle = (deg) => String(Math.round(deg * 10) / 10);

function landscapeBlock() {
  const pref = planLandscapePref();
  const count = state.project.site?.landscape?.objects?.length || 0;
  return `
    <h3>Ландшафт на плане</h3>
    <div class="prop-block views-ls" id="viewsLandscape">
      <label class="check-row"><input type="checkbox" id="viewsLsOn" ${pref.on ? 'checked' : ''}><span>Показывать ландшафт на плане</span><em>${count}</em></label>
      <div class="views-ls-groups${pref.on ? '' : ' off'}">
        ${PLAN_LS_GROUPS.map((g) => `<label class="check-row"><input type="checkbox" data-plan-ls="${g.id}" ${pref[g.id] ? 'checked' : ''} ${pref.on ? '' : 'disabled'}><span>${escapeHtml(g.title)}</span></label>`).join('')}
      </div>
      <button type="button" id="viewsLsPlanOnly">Только планировки</button>
      <p class="hint">Ландшафт — приглушённо под домом, чтобы видеть, куда чертить. На плане он не выбирается; правка — в режиме «Ландшафт». На листы и экспорт не влияет.</p>
    </div>`;
}

export function renderViewsPanel(panel) {
  const project = state.project;
  const mode = state.modeName || 'plan';
  const custom = customViewAngle(project, mode);
  const site = project.site;
  const outer = project.settings?.dimOuter !== false;
  panel.innerHTML = `
    <h2>Виды</h2>
    <h3>Поворот вида ${MODE_TITLES[mode] || ''}</h3>
    <div class="prop-block" id="viewsRotation">
      <button type="button" id="viewsAlignBtn"${state.tool?.kind === 'align-view' ? ' class="armed"' : ''}>⟲ Выровнять вид по двум точкам</button>
      <label class="prop-field"><span>Поворот вида, ° (по часовой)</span>
        <input id="viewsAngleInput" type="number" step="0.5" inputmode="decimal" value="${fmtAngle(viewAngle(project, mode))}"></label>
      <div class="prop-grid">
        <button type="button" id="viewsAngleReset" ${custom == null ? 'disabled' : ''}>Сбросить</button>
        <button type="button" id="viewsAxesBtn" ${isPlanEmpty(project) ? 'disabled' : ''} title="Повернуть оси дома (данные) по экрану этого вида; Ctrl+Z — вернуть">Оси дома по виду</button>
      </div>
      <p class="hint">У «Плана», «Участка» и «Ландшафта» — свой угол; данные проекта не меняются.</p>
    </div>
    <h3>Отображение</h3>
    <div class="prop-block">
      ${site?.underlay ? `<label class="check-row"><input type="checkbox" id="viewsUnderlay" ${state.underlayHidden ? '' : 'checked'}><span>Подложка (съёмка)</span></label>` : ''}
      <label class="check-row"><input type="checkbox" id="viewsDimOuter" ${outer ? 'checked' : ''}><span>Наружные размеры — по внешней грани стен</span></label>
      <button type="button" id="views3dBtn">Открыть 3D-вид</button>
    </div>
    ${landscapeBlock()}`;
  bindViews(panel);
}

// Поворот вида поменялся снаружи (панель ⟲, выравнивание по точкам).
export function refreshViewsPanel() {
  if (state.propsTab !== 'views' || !state.project) return;
  const mode = state.modeName || 'plan';
  // Узлы — из вкладки (их нет в index.html, панель рисуется кодом).
  const $ = (sel) => document.querySelector(`#propsBody ${sel}`);
  const input = $('#viewsAngleInput');
  if (input && document.activeElement !== input) input.value = fmtAngle(viewAngle(state.project, mode));
  const reset = $('#viewsAngleReset');
  if (reset) reset.disabled = customViewAngle(state.project, mode) == null;
  $('#viewsAlignBtn')?.classList.toggle('armed', state.tool?.kind === 'align-view');
}

function bindViews(panel) {
  const rerender = () => renderViewsPanel(panel);
  panel.querySelector('#viewsAlignBtn')?.addEventListener('click', () => { startAlignView(); refreshViewsPanel(); });
  panel.querySelector('#viewsAngleInput')?.addEventListener('change', (e) => {
    const v = Number(String(e.target.value).replace(',', '.'));
    if (Number.isFinite(v)) applyViewAngle(v);
    rerender();
  });
  panel.querySelector('#viewsAngleReset')?.addEventListener('click', () => { resetViewAngleCmd(); rerender(); });
  panel.querySelector('#viewsAxesBtn')?.addEventListener('click', () => { axesToViewCmd(); rerender(); });
  panel.querySelector('#viewsUnderlay')?.addEventListener('change', (e) => {
    state.underlayHidden = !e.target.checked;
    requestDraw();
  });
  // Как кнопка «Размеры» на колонке инструментов — тот же обработчик.
  panel.querySelector('#viewsDimOuter')?.addEventListener('change', (e) => {
    const outer = state.project.settings?.dimOuter !== false;
    if (outer !== e.target.checked) el('dimModeBtn')?.click();
  });
  panel.querySelector('#views3dBtn')?.addEventListener('click', () => el('view3dBtn')?.click());
  panel.querySelector('#viewsLsOn')?.addEventListener('change', (e) => {
    const pref = planLandscapePref();
    // Включили после «Только планировки» — вернуть группы по умолчанию.
    const empty = PLAN_LS_GROUPS.every((g) => !pref[g.id]);
    setPlanLandscapePref(e.target.checked && empty
      ? { on: true, plants: true, covers: true, objects: true }
      : { on: e.target.checked });
    requestDraw();
    rerender();
  });
  panel.querySelectorAll('[data-plan-ls]').forEach((box) => box.addEventListener('change', () => {
    setPlanLandscapePref({ [box.dataset.planLs]: box.checked });
    requestDraw();
  }));
  panel.querySelector('#viewsLsPlanOnly')?.addEventListener('click', () => {
    planOnlyPref();
    requestDraw();
    rerender();
  });
}

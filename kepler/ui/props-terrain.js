// Панель свойств рельефа: сводка (мин/макс, уклон, отметки под домом),
// настройки показа, отметка пола, ввод списком; свойства одной отметки.

import {
  HOUSE_DROP_WARN, formatElevation, houseTerrain, parseElevationM, terrainModel, terrainSummary,
} from '../core/terrain.js';
import { toast } from './dom.js';
import { deleteSelection } from './plan-actions.js';
import { state } from './state.js';
import { mutate, tweak } from './store.js';
import { selectObject } from './tools.js';
import { importXyzText, startTerrainTool } from './terrain.js';

const STEPS = [100, 200, 250, 500, 1000, 2000, 5000];
const m = (mm) => (mm / 1000).toFixed(2);

// Сводка для панели и e2e: null — отметок нет.
export function terrainInfo(project = state.project) {
  const terrain = project.site?.terrain;
  if (!terrain?.points?.length) return null;
  const model = terrainModel(terrain);
  return { summary: terrainSummary(model), house: houseTerrain(project, model) };
}

export function terrainSection() {
  const terrain = state.project.site?.terrain;
  const info = terrainInfo();
  const s = info?.summary;
  const house = info?.house;
  const show = terrain?.show || { points: true, contours: true, labels: true, shade: false };
  const step = terrain?.contourStep ?? 500;
  const rows = [];
  if (!s) {
    rows.push('<p class="empty-hint">Отметок высот нет — земля плоская. Инструмент «Отметка высоты» слева, импорт из DXF топосъёмки или вставка списком.</p>');
  } else {
    rows.push(`<div class="prop-row"><span>Отметок</span><strong id="terrainCount">${s.count}</strong></div>`);
    rows.push(`<div class="prop-row"><span>Мин / макс</span><strong id="terrainMinMax">${formatElevation(s.minZ)} / ${formatElevation(s.maxZ)} м</strong></div>`);
    if (s.error) {
      rows.push(`<p class="terrain-warn" id="terrainError">${s.error}</p>`);
    } else {
      rows.push(`<div class="prop-row"><span>Перепад участка</span><strong>${m(s.maxZ - s.minZ)} м</strong></div>`);
      rows.push(`<div class="prop-row"><span>Уклон средний / макс.</span><strong>${(s.meanSlope * 100).toFixed(1)} / ${(s.maxSlope * 100).toFixed(1)} %</strong></div>`);
    }
    if (s.duplicates) rows.push(`<p class="empty-hint">Совпадающих точек: ${s.duplicates} — в расчёте учтена первая.</p>`);
    if (house) {
      rows.push(`<div class="terrain-corners" id="terrainCorners">Углы дома: ${house.corners.map((c) => `${c.name} <b>${formatElevation(c.z)}</b>`).join(' · ')}<br>Центр <b>${formatElevation(house.center.z)}</b></div>`);
      rows.push(`<div class="prop-row"><span>Перепад под домом</span><strong id="terrainDrop" class="${house.warn ? 'bad' : ''}">${m(house.drop)} м</strong></div>`);
      if (house.warn) rows.push(`<p class="terrain-warn" id="terrainDropWarn">⚠ Перепад под домом > ${HOUSE_DROP_WARN / 1000} м — нужен высокий цоколь, терраса или планировка участка</p>`);
      if (house.outside) rows.push('<p class="empty-hint">Часть дома вне зоны отметок — там отметка взята по ближайшему краю.</p>');
    }
  }
  const floorAuto = house ? formatElevation(house.floorAuto) : '';
  return `
    <h3>Рельеф</h3>
    <div class="prop-block" id="terrainBlock">
      ${rows.join('\n')}
      ${s ? `<label class="prop-field"><span>Отметка пола 1 этажа (±0.000), м</span>
        <input id="floorZ" type="text" inputmode="decimal" placeholder="${floorAuto ? `авто: ${floorAuto}` : 'авто — средняя под домом'}" value="${terrain.floorZ != null ? formatElevation(terrain.floorZ) : ''}"></label>
      <label class="prop-field"><span>Шаг горизонталей</span>
        <select id="contourStep">${STEPS.map((v) => `<option value="${v}" ${v === step ? 'selected' : ''}>${(v / 1000).toLocaleString('ru-RU')} м</option>`).join('')}${STEPS.includes(step) ? '' : `<option value="${step}" selected>${(step / 1000).toLocaleString('ru-RU')} м</option>`}</select></label>
      <div class="check-grid">
        <label class="check-row"><input type="checkbox" id="tShowPoints" ${show.points ? 'checked' : ''}><span>Точки</span></label>
        <label class="check-row"><input type="checkbox" id="tShowContours" ${show.contours ? 'checked' : ''}><span>Горизонтали</span></label>
        <label class="check-row"><input type="checkbox" id="tShowLabels" ${show.labels ? 'checked' : ''}><span>Подписи</span></label>
        <label class="check-row"><input type="checkbox" id="tShowShade" ${show.shade ? 'checked' : ''}><span>Закраска высот</span></label>
      </div>` : ''}
      <div class="prop-actions">
        <button id="terrainTool">Отметка высоты — ставить кликом</button>
        <button id="xyzToggle">Вставить список x, y, z</button>
        ${s ? '<button id="terrainClear" class="danger">Удалить все отметки</button>' : ''}
      </div>
      <div class="terrain-xyz" id="xyzBlock" hidden>
        <label class="prop-field"><span>Строки «x, y, z» (из Excel, текста; разделитель — запятая, «;» или табуляция)</span>
          <textarea id="xyzText" placeholder="10.0	20.0	123.45&#10;25.5	18.0	123.80"></textarea></label>
        <div class="prop-grid">
          <label class="prop-field"><span>Единицы</span>
            <select id="xyzUnits"><option value="m">метры</option><option value="mm">мм</option></select></label>
          <label class="prop-field"><span>Координаты</span>
            <select id="xyzMode"><option value="cad">из съёмки (Y вверх), центр — к участку</option><option value="kepler">как в строке статуса (Y вниз)</option></select></label>
        </div>
        <button id="xyzApply" class="primary-inline">Добавить отметки</button>
      </div>
    </div>`;
}

export function bindTerrainSection(panel) {
  const site = state.project.site;
  const q = (id) => panel.querySelector(`#${id}`);
  q('terrainTool')?.addEventListener('click', startTerrainTool);
  q('xyzToggle')?.addEventListener('click', () => {
    const block = q('xyzBlock');
    block.hidden = !block.hidden;
    if (!block.hidden) q('xyzText').focus();
  });
  q('xyzApply')?.addEventListener('click', () => {
    importXyzText(q('xyzText').value, q('xyzUnits').value, q('xyzMode').value);
  });
  q('terrainClear')?.addEventListener('click', () => {
    mutate(() => { site.terrain.points = []; });
    toast('Отметки высот удалены (отмена — Ctrl+Z)');
  });
  q('floorZ')?.addEventListener('change', (e) => {
    const raw = String(e.target.value).trim();
    const z = raw ? parseElevationM(raw) : null;
    if (raw && z == null) { toast('Отметка пола — в метрах, например 123.60; пусто — авто'); return; }
    mutate(() => { site.terrain.floorZ = z; });
  });
  q('contourStep')?.addEventListener('change', (e) => {
    mutate(() => { site.terrain.contourStep = Number(e.target.value) || 500; });
  });
  for (const [id, key] of [['tShowPoints', 'points'], ['tShowContours', 'contours'], ['tShowLabels', 'labels'], ['tShowShade', 'shade']]) {
    q(id)?.addEventListener('change', (e) => {
      tweak(() => { site.terrain.show = { ...site.terrain.show, [key]: e.target.checked }; });
    });
  }
}

// Свойства одной отметки: число (м), координаты, удаление.
export function renderTerrainPointProps(panel, sel) {
  const terrain = state.project.site?.terrain;
  const p = terrain?.points.find((x) => x.id === sel.id);
  if (!p) return false;
  panel.innerHTML = `
    <h2>Отметка высоты</h2>
    <div class="prop-block">
      <label class="prop-field"><span>Отметка, м</span>
        <input id="tpZ" type="text" inputmode="decimal" value="${formatElevation(p.z)}"></label>
      <div class="prop-row"><span>X; Y (съёмка)</span><strong>${m(p.x)}; ${m(p.y)} м</strong></div>
    </div>
    <p class="empty-hint">Тяните точку на плане, чтобы передвинуть (инструмент «Отметка высоты»). Delete — удалить.</p>
    <div class="prop-actions"><button id="del" class="danger">Удалить отметку</button></div>
    ${terrainSection()}`;
  panel.querySelector('#tpZ').addEventListener('change', (e) => {
    const z = parseElevationM(e.target.value);
    if (z == null) { toast('Введите отметку в метрах, например 123.45'); return; }
    mutate(() => { p.z = z; });
    selectObject(sel);
  });
  panel.querySelector('#del').addEventListener('click', deleteSelection);
  bindTerrainSection(panel);
  return true;
}

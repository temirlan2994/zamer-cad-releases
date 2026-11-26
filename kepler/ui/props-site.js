// Панель свойств в режиме «Участок»: настройки участка и его объекты.

import { openClimatePanel } from './solar-analysis.js';
import { polygonAreaM2 } from '../core/site.js';
import { drawEntryPreview } from '../render.js';
import { ensureSiteEntries, entryAt, entryById, entryOverlaps, entryTitle, syncPrimaryEntry } from '../core/site-entries.js';
import { workingBuildableGeometry } from '../core/site-planning.js';
import { setBuildingOrigin } from '../core/site-check.js';
import { refs, toast } from './dom.js';
import { closeSheets } from './mobile.js';
import { deleteSelection } from './plan-actions.js';
import { setBuildingRotation } from './site-actions.js';
import { entryDirectionFields, readEntryDirections } from './site-entry-menu.js';
import { state } from './state.js';
import { mutate, tweak } from './store.js';
import { selectObject, setTool, startDraw } from './tools.js';
import { applyCalibration } from './underlay.js';
import { bindTerrainSection, renderTerrainPointProps, terrainSection } from './props-terrain.js';
import { importUnderlayMarks } from './terrain.js';
import { bindEnvelopeSettings, envelopeSettingsHtml } from './envelope-settings.js';

// --- Свойства участка ---

// Поле «Поворот дома»: оси комнат относительно участка (°, по часовой).
// Дом поворачивается на месте; по виду — «Развернуть оси дома по виду» (ui/view-align.js).
export function buildingRotationField() {
  const deg = state.project.building.rotation;
  const shown = Number((deg > 180 ? deg - 360 : deg).toFixed(2));
  return `<label class="prop-field"><span>Поворот дома, ° (оси комнат к участку)</span>
        <input id="buildingRot" type="number" step="0.5" value="${shown}"></label>`;
}

export function bindBuildingRotation(panel) {
  panel.querySelector('#buildingRot')?.addEventListener('change', (e) => {
    const warning = setBuildingRotation(Number(e.target.value) || 0);
    if (warning) toast(`⚠ ${warning}`, true);
  });
}

// Поля «X, Y дома» (м, координаты съёмки): где на участке лежит точка 0;0
// плана. Меняют building.origin — дом едет по участку целиком.
function buildingPositionFields() {
  const o = state.project.building?.origin || { x: 0, y: 0 };
  return `<div class="prop-grid">
        <label class="prop-field"><span>X дома, м</span>
          <input id="buildingX" type="number" step="0.05" value="${(o.x / 1000).toFixed(2)}"></label>
        <label class="prop-field"><span>Y дома, м</span>
          <input id="buildingY" type="number" step="0.05" value="${(o.y / 1000).toFixed(2)}"></label>
      </div>`;
}

function bindBuildingPosition(panel) {
  for (const axis of ['x', 'y']) {
    panel.querySelector(`#building${axis.toUpperCase()}`)?.addEventListener('change', (e) => {
      const v = Number(String(e.target.value).replace(',', '.'));
      if (!Number.isFinite(v)) return;
      const o = state.project.building?.origin || { x: 0, y: 0 };
      const next = { ...o, [axis]: Math.round(v * 1000) };
      mutate(() => { state.project.building = setBuildingOrigin(state.project.building, next.x, next.y); });
    });
  }
}

export function renderSiteSettings(panel) {
  const site = state.project.site;
  const working = site.boundary ? workingBuildableGeometry(site) : null;
  panel.innerHTML = `
    <h2>Участок</h2>
    <div class="prop-block">
      <button id="importUnderlay" class="primary-inline" style="width:100%">📁 ${site.underlay ? 'Заменить топосъёмку' : 'Импортировать топосъёмку'}</button>
      <p class="empty-hint">PDF · JPG · PNG · DXF. DWG — сохраните из CAD как DXF.</p>
    </div>
    <div class="prop-block">
      <div class="prop-row"><span>Площадь участка</span><strong>${site.boundary ? `${polygonAreaM2(site.boundary).toFixed(1)} м²` : '—'}</strong></div>
      <div class="prop-row"><span>Рабочее пятно</span><strong>${working?.geometry?.length ? `${working.areaM2.toFixed(1)} м²` : '—'}</strong></div>
      ${buildingRotationField()}
      ${buildingPositionFields()}
    </div>
    ${envelopeSettingsHtml()}
    ${terrainSection()}
    <h3>Проектные ограничения</h3>
    <div class="prop-block">
      <label class="prop-field"><span>От границы участка, м</span>
        <input id="setbackB" type="number" step="0.1" min="0" value="${(site.setbackBoundary / 1000).toFixed(1)}"></label>
      <label class="prop-field"><span>От соседнего дома, м</span>
        <input id="setbackN" type="number" step="0.5" min="0" value="${(site.setbackNeighbor / 1000).toFixed(1)}"></label>
      <label class="check-row"><input type="checkbox" id="showZone" ${site.showBuildZone ? 'checked' : ''}><span>Показывать рабочее пятно</span></label>
      <p class="empty-hint">Эскизная проверка по введённым значениям, не нормативное заключение. Проверьте ограничения по правилам вашего региона.</p>
    </div>
    <div class="prop-actions"><button type="button" data-climate-location-link>☀ Север и солнце →</button></div>`;

  panel.querySelector('#importUnderlay').addEventListener('click', () => refs.underlayInput.click());
  bindBuildingRotation(panel);
  bindBuildingPosition(panel);
  bindEnvelopeSettings(panel);
  bindTerrainSection(panel);
  panel.querySelector('[data-climate-location-link]').addEventListener('click', (e) => openClimatePanel(e.currentTarget, { location: true }));
  panel.querySelector('#setbackB').addEventListener('change', (e) => {
    mutate(() => { site.setbackBoundary = Math.max(0, Number(e.target.value) || 0) * 1000; });
  });
  panel.querySelector('#setbackN').addEventListener('change', (e) => {
    mutate(() => { site.setbackNeighbor = Math.max(0, Number(e.target.value) || 0) * 1000; });
  });
  panel.querySelector('#showZone').addEventListener('change', (e) => {
    mutate(() => { site.showBuildZone = e.target.checked; });
  });

}

export function renderSiteObjectProps(panel, sel) {
  const site = state.project.site;
  if (sel.kind === 'terrain-point' && renderTerrainPointProps(panel, sel)) return;
  if (sel.kind === 'building') {
    panel.innerHTML = `
      <h2>Дом на участке</h2>
      <div class="prop-block">
        ${buildingRotationField()}
        ${buildingPositionFields()}
      </div>
      <p class="empty-hint">Тяните дом мышью за любую комнату или двигайте стрелками (шаг 50 мм, Shift — 0,5 м). Мебель и комнаты правятся в «Плане».</p>`;
    bindBuildingRotation(panel);
    bindBuildingPosition(panel);
    return;
  }
  if (sel.kind === 'boundary' && site.boundary) {
    panel.innerHTML = `
      <h2>Граница участка</h2>
      <div class="prop-block">
        <div class="prop-row"><span>Площадь</span><strong>${polygonAreaM2(site.boundary).toFixed(1)} м²</strong></div>
        <div class="prop-row"><span>Вершин</span><strong>${site.boundary.length}</strong></div>
      </div>
      <p class="empty-hint">Тяните белые точки-вершины, чтобы поправить контур. Красная штриховка — запретная полоса отступа.</p>
      <div class="prop-actions">
        <button id="redraw">Перечертить заново</button>
        <button id="del" class="danger">Удалить границу</button>
      </div>`;
    panel.querySelector('#redraw').addEventListener('click', () => startDraw('boundary'));
    panel.querySelector('#del').addEventListener('click', deleteSelection);
    return;
  }
  if (sel.kind === 'redline' && site.redLine) {
    panel.innerHTML = `
      <h2>Красная линия</h2>
      <p class="empty-hint">Линия регулирования застройки со стороны улицы. Тяните вершины, чтобы поправить.</p>
      <div class="prop-actions">
        <button id="redraw">Перечертить</button>
        <button id="del" class="danger">Удалить</button>
      </div>`;
    panel.querySelector('#redraw').addEventListener('click', () => startDraw('redline'));
    panel.querySelector('#del').addEventListener('click', deleteSelection);
    return;
  }
  if (sel.kind === 'road') {
    const road = site.roads.find((r) => r.id === sel.id);
    if (!road) { renderSiteSettings(panel); return; }
    panel.innerHTML = `
      <h2>Дорога</h2>
      <div class="prop-block">
        <label class="prop-field"><span>Ширина, м</span>
          <input id="roadW" type="number" step="0.5" min="1" value="${(road.width / 1000).toFixed(1)}"></label>
      </div>
      <div class="prop-actions"><button id="del" class="danger">Удалить дорогу</button></div>`;
    panel.querySelector('#roadW').addEventListener('change', (e) => {
      mutate(() => { road.width = Math.max(1000, (Number(e.target.value) || 3.5) * 1000); });
      selectObject(sel);
    });
    panel.querySelector('#del').addEventListener('click', deleteSelection);
    return;
  }
  if (sel.kind === 'neighbor') {
    const n = site.neighbors.find((x) => x.id === sel.id);
    if (!n) { renderSiteSettings(panel); return; }
    panel.innerHTML = `
      <h2>Соседний дом</h2>
      <div class="prop-block">
        <div class="prop-grid">
          <label class="prop-field"><span>Ширина, м</span><input id="nw" type="number" step="0.5" min="2" value="${(n.w / 1000).toFixed(1)}"></label>
          <label class="prop-field"><span>Глубина, м</span><input id="nh" type="number" step="0.5" min="2" value="${(n.h / 1000).toFixed(1)}"></label>
        </div>
        <label class="prop-field"><span>Высота (для теней), м</span><input id="nht" type="number" step="0.5" min="2" value="${((n.height || 6000) / 1000).toFixed(1)}"></label>
      </div>
      <label class="prop-field"><span>Поворот, °</span><input id="nrot" type="number" step="5" value="${Math.round(n.rot || 0)}"></label>
      <p class="empty-hint">Тяните квадраты по углам — масштаб, круглые ручки снаружи углов — поворот (шаг 5°, с Shift — 15°). Вокруг дома держится отступ ${(site.setbackNeighbor / 1000).toLocaleString('ru-RU')} м (красная штриховка).</p>
      <div class="prop-actions"><button id="del" class="danger">Удалить</button></div>`;
    const apply = () => {
      mutate(() => {
        n.w = Math.max(2000, (Number(panel.querySelector('#nw').value) || 8) * 1000);
        n.h = Math.max(2000, (Number(panel.querySelector('#nh').value) || 8) * 1000);
        n.height = Math.max(2000, (Number(panel.querySelector('#nht').value) || 6) * 1000);
        n.rot = ((Number(panel.querySelector('#nrot').value) || 0) % 360 + 360) % 360;
      });
      selectObject(sel);
    };
    panel.querySelector('#nw').addEventListener('change', apply);
    panel.querySelector('#nh').addEventListener('change', apply);
    panel.querySelector('#nht').addEventListener('change', apply);
    panel.querySelector('#nrot').addEventListener('change', apply);
    panel.querySelector('#del').addEventListener('click', deleteSelection);
    return;
  }
  if (sel.kind === 'entry') {
    const entry = entryById(site, sel.id);
    if (!entry) { renderSiteSettings(panel); return; }
    const wicket = entry.kind === 'wicket';
    panel.innerHTML = `
      <h2>${entryTitle(entry)}</h2>
      <canvas class="entry-props-preview" id="entryPreview" width="480" height="200" aria-label="Предпросмотр ворот или калитки"></canvas>
      <div class="prop-block">
        <label class="prop-field"><span>${wicket ? 'Тип калитки' : 'Тип ворот'}</span><select id="entryOpening"><option value="swing" ${entry.opening !== 'sliding' ? 'selected' : ''}>${wicket ? 'Распашная' : 'Распашные'}</option><option value="sliding" ${entry.opening === 'sliding' ? 'selected' : ''}>${wicket ? 'Раздвижная' : 'Раздвижные'}</option></select></label>
        ${entryDirectionFields(entry, 'entry')}
        <label class="prop-field"><span>${wicket ? 'Ширина калитки' : 'Ширина ворот'}, мм</span>
          <input id="entryWidth" type="number" min="${wicket ? 600 : 2000}" max="${wicket ? 2000 : 10000}" step="50" value="${entry.width || (wicket ? 1000 : 4000)}"></label>
        <label class="prop-field"><span>Высота, мм</span><input id="entryHeight" type="number" min="600" max="4000" step="50" value="${entry.height || 1800}"></label>
        ${wicket ? '' : `<label class="check-row"><input id="entryWicket" type="checkbox" ${entry.wicket ? 'checked' : ''}><span>Калитка рядом с воротами</span></label>
        ${entry.wicket ? `<h3>Боковая калитка</h3><label class="prop-field"><span>Сторона калитки (со стороны участка)</span><select id="entryWicketSide"><option value="left" ${entry.wicketSide === 'left' ? 'selected' : ''}>Слева</option><option value="right" ${entry.wicketSide !== 'left' ? 'selected' : ''}>Справа</option></select></label>
        <label class="prop-field"><span>Ширина калитки, мм</span><input id="entryWicketWidth" type="number" min="600" max="2000" step="50" value="${entry.wicketWidth || 1000}"></label>
        <label class="prop-field"><span>Тип боковой калитки</span><select id="entryWicketOpening"><option value="swing" ${entry.wicketOpening !== 'sliding' ? 'selected' : ''}>Распашная</option><option value="sliding" ${entry.wicketOpening === 'sliding' ? 'selected' : ''}>Раздвижная</option></select></label>
        ${entryDirectionFields({ kind: 'wicket', opening: entry.wicketOpening, swingSide: entry.wicketSwingSide, hinge: entry.wicketHinge, slideDirection: entry.wicketSlideDirection }, 'entryWicket')}` : ''}`}
      </div>
      <p class="empty-hint">Тяните вдоль границы, чтобы передвинуть. Кнопка «Въезд» открывает выбор ворот и калитки.</p>
      <div class="prop-actions"><button id="entryAdd">Добавить ещё</button><button id="del" class="danger">Удалить</button></div>`;
    const apply = () => {
      const width = Number(panel.querySelector('#entryWidth').value);
      const height = Number(panel.querySelector('#entryHeight').value);
      if (!Number.isFinite(width) || width < (wicket ? 600 : 2000) || width > (wicket ? 2000 : 10000) || !Number.isFinite(height) || height < 600 || height > 4000) {
        toast('Проверьте ширину и высоту'); renderSiteObjectProps(panel, sel); return;
      }
      const opening = panel.querySelector('#entryOpening').value;
      const wicketOpening = panel.querySelector('#entryWicketOpening')?.value || entry.wicketOpening || 'swing';
      const wicketDirections = readEntryDirections(panel, { opening: wicketOpening, swingSide: entry.wicketSwingSide, hinge: entry.wicketHinge, slideDirection: entry.wicketSlideDirection }, 'entryWicket');
      const next = { ...entry, ...readEntryDirections(panel, { ...entry, opening }, 'entry'), width, height, opening,
        wicketOpening, wicketSwingSide: wicketDirections.swingSide, wicketHinge: wicketDirections.hinge, wicketSlideDirection: wicketDirections.slideDirection,
        wicket: panel.querySelector('#entryWicket')?.checked || false,
        wicketSide: panel.querySelector('#entryWicketSide')?.value || entry.wicketSide || 'right',
        wicketWidth: panel.querySelector('#entryWicketWidth') ? Number(panel.querySelector('#entryWicketWidth').value) : entry.wicketWidth || 1000 };
      if (next.wicketWidth < 600 || next.wicketWidth > 2000) { toast('Ширина калитки: от 600 до 2000 мм'); renderSiteObjectProps(panel, sel); return; }
      const spot = entryAt(site, next, next);
      if (!spot || entryOverlaps(site, { ...next, ...spot }, entry.id)) { toast('Недостаточно места: рядом угол, ворота или калитка'); renderSiteObjectProps(panel, sel); return; }
      mutate(() => {
        ensureSiteEntries(site);
        Object.assign(entryById(site, entry.id), next, { x: spot.x, y: spot.y, dir: spot.dir });
        syncPrimaryEntry(site);
      });
      selectObject({ ...sel, id: entry.id });
    };
    drawEntryPreview(panel.querySelector('#entryPreview'), entry);
    for (const input of panel.querySelectorAll('input, select')) input.addEventListener('change', apply);
    panel.querySelector('#entryAdd').addEventListener('click', () => {
      const preset = { ...entry };
      delete preset.id;
      setTool({ ...preset, kind: 'entry', entryKind: entry.kind || 'gate' }, 'Кликните по свободному месту на границе участка');
      closeSheets();
    });
    panel.querySelector('#del').addEventListener('click', deleteSelection);
    return;
  }
  if (sel.kind === 'underlay' && site.underlay) {
    const u = site.underlay;
    const cal = state.calibration;
    const widthM = (u.widthPx * u.mmPerPx) / 1000;
    const heightM = (u.heightPx * u.mmPerPx) / 1000;
    const marks = Array.isArray(u.marks) ? u.marks.length : 0;
    panel.innerHTML = `
      <h2>Топосъёмка</h2>
      <p class="subtitle">Размер картинки: ${widthM.toFixed(1)} × ${heightM.toFixed(1)} м</p>
      ${marks ? `
      <div class="prop-block cal-active">
        <strong>В DXF найдено отметок высот: ${marks}</strong>
        <button id="importMarks" class="primary-inline">Импортировать отметки из подложки DXF</button>
        <p class="empty-hint">Сначала задайте масштаб и положение подложки: отметки встанут по ней. Повторный импорт заменит прежние DXF-отметки.</p>
      </div>` : ''}
      <h3>Масштаб — 3 способа</h3>
      <div class="prop-block">
        <label class="prop-field"><span>1. Ширина топосъёмки, м (если знаете)</span>
          <input id="uWidth" type="number" step="0.5" min="1" value="${widthM.toFixed(1)}"></label>
        <div class="scale-row">
          <span>2. Подогнать кнопками</span>
          <div class="scale-btns">
            <button id="scaleDown" title="Меньше">−</button>
            <button id="scaleUp" title="Больше">+</button>
          </div>
        </div>
        <p class="empty-hint">3. Или тяните угловые белые квадраты прямо на картинке.</p>
      </div>
      ${cal ? `
      <div class="prop-block cal-active">
        <strong>Отрезок отмечен.</strong>
        <label class="prop-field"><span>Его реальная длина, м</span>
          <input id="calDist" type="number" step="0.1" min="0.1" placeholder="например 20" autofocus></label>
        <button id="calApply" class="primary-inline">Применить</button>
      </div>` : `
      <div class="prop-actions">
        <button id="calibrate">4. Точно: масштаб по отрезку</button>
      </div>`}
      <h3>Вид</h3>
      <div class="prop-block">
        <label class="prop-field"><span>Поворот, °</span>
          <input id="uRot" type="number" step="1" value="${Math.round(u.rot || 0)}"></label>
        <label class="prop-field"><span>Прозрачность</span>
          <input id="uOpacity" type="range" min="0.1" max="1" step="0.05" value="${u.opacity}"></label>
        <label class="check-row"><input type="checkbox" id="uLocked" ${u.locked ? 'checked' : ''}><span>Закрепить (не двигать и не масштабировать мышью)</span></label>
        <p class="empty-hint">Поворот также тянется круглыми ручками у углов картинки.</p>
      </div>
      <div class="prop-actions">
        <button id="replaceUnderlay">📁 Заменить файл</button>
        <button id="del" class="danger">Удалить подложку</button>
      </div>
      <p class="empty-hint">Совет: начертите границу участка по топосъёмке, затем подгоните масштаб так, чтобы известная сторона совпала с реальной длиной.</p>`;

    const rescale = (factor) => {
      mutate(() => {
        const cx = u.x + (u.widthPx * u.mmPerPx) / 2;
        const cy = u.y + (u.heightPx * u.mmPerPx) / 2;
        u.mmPerPx = Math.max(0.5, u.mmPerPx * factor);
        u.x = cx - (u.widthPx * u.mmPerPx) / 2;
        u.y = cy - (u.heightPx * u.mmPerPx) / 2;
      });
      selectObject(sel);
    };
    panel.querySelector('#uWidth').addEventListener('change', (e) => {
      const targetM = Number(e.target.value);
      if (!(targetM > 0)) return;
      const factor = (targetM * 1000) / (u.widthPx * u.mmPerPx);
      rescale(factor);
    });
    panel.querySelector('#scaleUp').addEventListener('click', () => rescale(1.1));
    panel.querySelector('#scaleDown').addEventListener('click', () => rescale(1 / 1.1));
    panel.querySelector('#uOpacity').addEventListener('input', (e) => {
      tweak(() => { u.opacity = Number(e.target.value); });
    });
    panel.querySelector('#uRot').addEventListener('change', (e) => {
      const deg = Number(e.target.value);
      if (Number.isNaN(deg)) return;
      mutate(() => { u.rot = ((deg % 360) + 360) % 360; });
      selectObject(sel);
    });
    panel.querySelector('#uLocked').addEventListener('change', (e) => {
      mutate(() => { u.locked = e.target.checked; });
      selectObject(sel);
    });
    const calibrateBtn = panel.querySelector('#calibrate');
    if (calibrateBtn) {
      calibrateBtn.addEventListener('click', () => {
        setTool({ kind: 'calibrate', points: [] }, 'Кликните две точки на топосъёмке с известным расстоянием (например, сторону участка)');
      });
    }
    panel.querySelector('#replaceUnderlay').addEventListener('click', () => refs.underlayInput.click());
    panel.querySelector('#importMarks')?.addEventListener('click', () => { importUnderlayMarks(); selectObject(sel); });
    panel.querySelector('#del').addEventListener('click', deleteSelection);
    if (cal) {
      panel.querySelector('#calApply').addEventListener('click', () => {
        applyCalibration(Number(panel.querySelector('#calDist').value));
      });
    }
    return;
  }
  renderSiteSettings(panel);
}

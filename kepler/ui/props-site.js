// Панель свойств в режиме «Участок»: настройки участка и его объекты.

import { buildZonePolygon, formatSunInfo, polygonAreaM2, sunPosition } from '../core/site.js';
import { refs, toast } from './dom.js';
import { applyModeRotation } from './modes.js';
import { deleteSelection } from './plan-actions.js';
import { setBuildingRotation } from './site-actions.js';
import { state } from './state.js';
import { mutate, tweak } from './store.js';
import { selectObject, setTool, startDraw } from './tools.js';
import { applyCalibration } from './underlay.js';
import { requestDraw } from './view.js';

// --- Свойства участка ---

// Поле «Поворот дома»: оси комнат относительно участка (°, по часовой).
// Дом поворачивается на месте; «Выровнять» задаёт то же по 2 точкам.
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

export function renderSiteSettings(panel) {
  const site = state.project.site;
  const sun = sunPosition(site.location.lat, site.location.lon, site.location.tz, site.sun.date, site.sun.time);
  const zone = site.boundary ? buildZonePolygon(site) : null;
  const hours = Math.floor(site.sun.time / 60);
  const mins = site.sun.time % 60;
  panel.innerHTML = `
    <h2>Участок</h2>
    <div class="prop-block">
      <button id="importUnderlay" class="primary-inline" style="width:100%">📁 ${site.underlay ? 'Заменить топосъёмку' : 'Импортировать топосъёмку'}</button>
      <p class="empty-hint">PDF · JPG · PNG · DXF. DWG — сохраните из CAD как DXF.</p>
    </div>
    <div class="prop-block">
      <div class="prop-row"><span>Площадь участка</span><strong>${site.boundary ? `${polygonAreaM2(site.boundary).toFixed(1)} м²` : '—'}</strong></div>
      <div class="prop-row"><span>Зона застройки</span><strong>${zone ? `${polygonAreaM2(zone).toFixed(1)} м²` : '—'}</strong></div>
      <label class="prop-field"><span>Север, ° по часовой (0 = вверх съёмки)</span>
        <input id="northDeg" type="number" step="1" value="${Math.round(site.north)}"></label>
      ${buildingRotationField()}
    </div>
    <h3>Отступы застройки</h3>
    <div class="prop-block">
      <label class="prop-field"><span>От границы участка, м</span>
        <input id="setbackB" type="number" step="0.1" min="0" value="${(site.setbackBoundary / 1000).toFixed(1)}"></label>
      <label class="prop-field"><span>От соседнего дома, м</span>
        <input id="setbackN" type="number" step="0.5" min="0" value="${(site.setbackNeighbor / 1000).toFixed(1)}"></label>
      <label class="check-row"><input type="checkbox" id="showZone" ${site.showBuildZone ? 'checked' : ''}><span>Показывать зону застройки</span></label>
    </div>
    <h3>Инсоляция</h3>
    <div class="prop-block">
      <label class="check-row"><input type="checkbox" id="sunEnabled" ${site.sun.enabled ? 'checked' : ''}><span>Показывать солнце и тени</span></label>
      <div class="prop-grid">
        <label class="prop-field"><span>Широта</span><input id="lat" type="number" step="0.001" value="${site.location.lat}"></label>
        <label class="prop-field"><span>Долгота</span><input id="lon" type="number" step="0.001" value="${site.location.lon}"></label>
      </div>
      <div class="prop-grid">
        <label class="prop-field"><span>Пояс UTC+</span><input id="tz" type="number" step="1" value="${site.location.tz}"></label>
        <label class="prop-field"><span>Высота дома, м</span><input id="bh" type="number" step="0.5" min="2" value="${(site.buildingHeight / 1000).toFixed(1)}"></label>
      </div>
      <label class="prop-field"><span>Дата</span><input id="sunDate" type="date" value="${site.sun.date}"></label>
      <label class="prop-field"><span>Время: <b id="sunTimeLabel">${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}</b></span>
        <input id="sunTime" type="range" min="0" max="1440" step="15" value="${site.sun.time}"></label>
      <div class="prop-row"><span>Солнце</span><strong id="sunInfo">${formatSunInfo(sun)}</strong></div>
    </div>
    <p class="empty-hint">Границу, красную линию, въезд и дорогу добавляйте инструментами слева. В этом режиме север всегда вверх; вернитесь в «План» — камера станет прежней.</p>`;

  panel.querySelector('#importUnderlay').addEventListener('click', () => refs.underlayInput.click());
  bindBuildingRotation(panel);
  panel.querySelector('#northDeg').addEventListener('change', (e) => {
    mutate(() => { site.north = ((Number(e.target.value) || 0) % 360 + 360) % 360; });
    applyModeRotation();
    requestDraw();
  });
  panel.querySelector('#setbackB').addEventListener('change', (e) => {
    mutate(() => { site.setbackBoundary = Math.max(0, Number(e.target.value) || 0) * 1000; });
  });
  panel.querySelector('#setbackN').addEventListener('change', (e) => {
    mutate(() => { site.setbackNeighbor = Math.max(0, Number(e.target.value) || 0) * 1000; });
  });
  panel.querySelector('#showZone').addEventListener('change', (e) => {
    mutate(() => { site.showBuildZone = e.target.checked; });
  });
  panel.querySelector('#sunEnabled').addEventListener('change', (e) => {
    tweak(() => { site.sun.enabled = e.target.checked; });
  });
  const updateSun = () => {
    const s = sunPosition(site.location.lat, site.location.lon, site.location.tz, site.sun.date, site.sun.time);
    const info = panel.querySelector('#sunInfo');
    if (info) info.textContent = formatSunInfo(s);
  };
  for (const [id, apply] of [
    ['lat', (v) => { site.location.lat = Number(v) || 0; }],
    ['lon', (v) => { site.location.lon = Number(v) || 0; }],
    ['tz', (v) => { site.location.tz = Number(v) || 0; }],
    ['bh', (v) => { site.buildingHeight = Math.max(2000, (Number(v) || 6) * 1000); }],
    ['sunDate', (v) => { if (/^\d{4}-\d{2}-\d{2}$/.test(v)) site.sun.date = v; }],
  ]) {
    panel.querySelector(`#${id}`).addEventListener('change', (e) => {
      tweak(() => apply(e.target.value));
      updateSun();
    });
  }
  panel.querySelector('#sunTime').addEventListener('input', (e) => {
    tweak(() => { site.sun.time = Number(e.target.value); });
    const h = Math.floor(site.sun.time / 60);
    const m = site.sun.time % 60;
    panel.querySelector('#sunTimeLabel').textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    updateSun();
  });
}

export function renderSiteObjectProps(panel, sel) {
  const site = state.project.site;
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
  if (sel.kind === 'entry' && site.entry) {
    panel.innerHTML = `
      <h2>Въезд</h2>
      <p class="empty-hint">Перетащите стрелку вдоль границы, чтобы передвинуть въезд.</p>
      <div class="prop-actions"><button id="del" class="danger">Удалить въезд</button></div>`;
    panel.querySelector('#del').addEventListener('click', deleteSelection);
    return;
  }
  if (sel.kind === 'underlay' && site.underlay) {
    const u = site.underlay;
    const cal = state.calibration;
    const widthM = (u.widthPx * u.mmPerPx) / 1000;
    const heightM = (u.heightPx * u.mmPerPx) / 1000;
    panel.innerHTML = `
      <h2>Топосъёмка</h2>
      <p class="subtitle">Размер картинки: ${widthM.toFixed(1)} × ${heightM.toFixed(1)} м</p>
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

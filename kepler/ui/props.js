// Правая панель свойств: проект, комната, стена, проём, мебель, группа.

import { furnitureDef, isShaft, roomType } from '../core/catalog.js';
import { itemTitle, itemsInRoom } from '../core/furnish.js';
import { activeLevel, levelProject, roomById } from '../core/model.js';
import { SP55 } from '../core/norms.js';
import { MIN_ROOM_SIZE, MIN_SHAFT_SIZE, roomNetAreaM2, totalAreaM2 } from '../core/rooms.js';
import {
  DOOR_TYPES, WALL_T_MAX, WALL_T_MIN, WINDOW_TYPES, deriveWalls, openingFrame, openingPos, openingRect,
  projectHasManualWalls, setOpeningPos, wallClassThickness, wallsEngine,
} from '../core/walls.js';
import { moveManualWall, setManualWallJustify, setWallHeight } from '../core/wall-manual.js';
import { roomShapeArea } from '../core/room-shape.js';
import { fitOpeningOffset } from '../core/opening-spacing.js';
import { setWallDefaults } from '../core/wall-thickness.js';
import { escapeHtml, refs, toast } from './dom.js';
import { findWall } from './hit.js';
import { hotkeysHtml } from './help.js';
import { deleteLevel } from './levels.js';
import { syncMobileBar } from './mobile.js';
import { tepSection } from './norms-view.js';
import {
  addFurniture, changeManualWall, changeWallKind, changeWallThickness, overlappingTopRooms, reconcileOpenings,
} from './plan-actions.js';
import {
  bindBuildingRotation, buildingRotationField, renderSiteObjectProps, renderSiteSettings,
} from './props-site.js';
import { resizeVerdict } from './snap.js';
import { STAIR_SHAPES, applyStairPreset, stairCalculation, stairShape } from '../core/stairs.js';
import { state } from './state.js';
import { bindVariants, variantsSection } from './variants.js';
import { isFixedSizeComp } from '../core/composite.js';
import { bindCompositeSection, compositeSection } from './props-composite.js';
import { afterChange, mutate, pushHistory, refreshDerived, snapshot } from './store.js';
import { selectObject } from './tools.js';
import { renderLandscapeProps } from './landscape.js';

export function renderProps() {
  syncMobileBar();
  const sel = state.selection;
  const panel = refs.props;
  if (state.modeName === 'landscape' && (!sel || sel.type === 'landscape')) { renderLandscapeProps(panel); return; }
  if (!sel) {
    if (state.modeName === 'site') renderSiteSettings(panel);
    else renderProjectProps(panel);
    return;
  }
  if (sel.type === 'room') { renderRoomProps(panel, roomById(state.project, sel.id)); return; }
  if (sel.type === 'wall') { renderWallProps(panel, findWall(sel.key, sel.from)); return; }
  if (sel.type === 'opening') { renderOpeningProps(panel, state.project.openings.find((o) => o.id === sel.id)); return; }
  if (sel.type === 'item') { renderItemProps(panel, state.project.items.find((i) => i.id === sel.id)); return; }
  if (sel.type === 'multi') { renderMultiProps(panel, sel); return; }
  if (sel.type === 'site') { renderSiteObjectProps(panel, sel); return; }
  renderProjectProps(panel);
}

// Чистая высота по умолчанию: высота этажа минус перекрытие (core/norms.js).
function defaultCeiling() {
  return activeLevel(state.project).height - SP55.slab;
}

// Движок стен: v2 — стена как область (по умолчанию), v1 — устаревшие полосы
// с заплатками стыков (будет удалён). Параметр адреса ?walls=v1|v2 главнее
// настройки проекта — тогда выбор заблокирован.
function wallsEngineField() {
  // Ручные стены существуют только в v2: с ними выбор заблокирован.
  const manualLocked = projectHasManualWalls(state.project);
  const own = !manualLocked && state.project.settings.wallsEngine === 'v1' ? 'v1' : 'v2';
  const urlLocked = !manualLocked && /[?&]walls=(v1|v2)(?:&|$)/.test(globalThis.location?.search || '');
  const active = wallsEngine(state.project);
  return `<label class="prop-field"><span>Движок стен</span>
        <select id="wallsEngineSel" ${urlLocked || manualLocked ? 'disabled' : ''}>
          <option value="v2" ${own === 'v2' ? 'selected' : ''}>v2 — стена как область</option>
          <option value="v1" ${own === 'v1' ? 'selected' : ''}>v1 — старый, будет удалён</option>
        </select></label>
      ${manualLocked ? '<p class="empty-hint">В проекте есть ручные стены — они строятся только движком v2.</p>' : ''}
      ${urlLocked ? `<p class="empty-hint">Задан адресом страницы (?walls=${active}).</p>` : ''}`;
}

function renderProjectProps(panel) {
  const rooms = state.project.rooms;
  const site = state.project.site;
  const hasSite = Boolean(site?.boundary?.length || site?.underlay);
  const level = activeLevel(state.project);
  const multi = state.project.levels.length > 1;
  const allArea = state.project.levels.reduce((sum, l) => sum + totalAreaM2(levelProject(state.project, l.id)), 0);
  const list = rooms.map((r) => {
    const area = roomNetAreaM2(state.project, r).toFixed(1);
    const nested = r.parentId ? ' ↳ ' : '';
    return `<li><button class="link" data-room="${r.id}">${nested}${escapeHtml(r.name)}</button><span>${area} м²</span></li>`;
  }).join('');
  panel.innerHTML = `
    <h2>Проект</h2>
    <div class="prop-block">
      <div class="prop-row"><span>Помещений${multi ? ' на этаже' : ''}</span><strong>${rooms.length}</strong></div>
      <div class="prop-row"><span>${multi ? 'Площадь этажа' : 'Общая площадь'}</span><strong>${totalAreaM2(state.project).toFixed(1)} м²</strong></div>
      ${multi ? `<div class="prop-row"><span>Всего (${state.project.levels.length} эт.)</span><strong>${allArea.toFixed(1)} м²</strong></div>` : ''}
      ${hasSite ? buildingRotationField() : ''}
      <label class="prop-field"><span>Размеры на плане</span>
        <select id="unitsSel">
          <option value="mm" ${state.project.settings.units !== 'm' ? 'selected' : ''}>в миллиметрах — 5000</option>
          <option value="m" ${state.project.settings.units === 'm' ? 'selected' : ''}>в метрах — 5,00</option>
        </select></label>
    </div>
    <h3>Стены по умолчанию, мм</h3>
    <div class="prop-block">
      <div class="prop-grid">
        <label class="prop-field"><span>Наружные</span>
          <input id="defExterior" data-wall-default="exterior" type="number" step="10" min="${WALL_T_MIN}" max="${WALL_T_MAX}" value="${wallClassThickness(state.project.settings, 'exterior')}"></label>
        <label class="prop-field"><span>Несущие</span>
          <input id="defBearing" data-wall-default="bearing" type="number" step="10" min="${WALL_T_MIN}" max="${WALL_T_MAX}" value="${wallClassThickness(state.project.settings, 'bearing')}"></label>
        <label class="prop-field"><span>Перегородки</span>
          <input id="defPartition" data-wall-default="partition" type="number" step="10" min="${WALL_T_MIN}" max="${WALL_T_MAX}" value="${wallClassThickness(state.project.settings, 'partition')}"></label>
      </div>
      <p class="empty-hint">Наружные стены без своей толщины меняются сразу. Новая перегородка — для новых стыковок: уже построенные сохраняют свою толщину.</p>
      ${wallsEngineField()}
    </div>
    <h3>Этаж</h3>
    <div class="prop-block">
      <label class="prop-field"><span>Название</span><input id="levelName" value="${escapeHtml(level.name)}"></label>
      <div class="prop-grid">
        <label class="prop-field"><span>Отметка пола, м</span>
          <input id="levelElev" type="number" step="0.05" value="${(level.elevation / 1000).toFixed(2)}"></label>
        <label class="prop-field"><span>Высота этажа, м</span>
          <input id="levelHeight" type="number" step="0.05" min="2" value="${(level.height / 1000).toFixed(2)}"></label>
      </div>
      ${multi ? '<button id="deleteLevel" class="danger">Удалить этаж</button>' : '<p class="empty-hint">Второй этаж — кнопка «+» внизу слева на плане.</p>'}
    </div>
    ${rooms.length ? `<h3>Состав</h3><ul class="room-list">${list}</ul>` : `
    <p class="empty-hint">Выберите тип помещения слева и кликните на плане. Комнаты стыкуются автоматически — общая стена становится единой. Перетащите маленькую комнату внутрь большой — она вложится и отнимет площадь.</p>`}
    ${tepSection()}
    ${variantsSection()}
    <h3>Управление</h3>
    ${hotkeysHtml()}`;
  panel.querySelectorAll('[data-room]').forEach((btn) => {
    btn.addEventListener('click', () => selectObject({ type: 'room', id: btn.dataset.room }));
  });
  bindBuildingRotation(panel);
  panel.querySelector('#unitsSel').addEventListener('change', (e) => {
    mutate(() => { state.project.settings.units = e.target.value === 'm' ? 'm' : 'mm'; });
  });
  panel.querySelector('#wallsEngineSel')?.addEventListener('change', (e) => {
    mutate(() => {
      if (e.target.value === 'v1') state.project.settings.wallsEngine = 'v1';
      else delete state.project.settings.wallsEngine; // v2 — по умолчанию
    });
  });
  panel.querySelectorAll('[data-wall-default]').forEach((input) => {
    input.addEventListener('change', (e) => {
      mutate(() => { setWallDefaults(state.project, { [input.dataset.wallDefault]: e.target.value }); });
    });
  });
  panel.querySelector('#levelName').addEventListener('change', (e) => {
    const name = e.target.value.trim();
    if (name) mutate(() => { level.name = name; });
  });
  panel.querySelector('#levelElev').addEventListener('change', (e) => {
    mutate(() => { level.elevation = Math.round((Number(e.target.value) || 0) * 1000); });
  });
  panel.querySelector('#levelHeight').addEventListener('change', (e) => {
    mutate(() => { level.height = Math.max(2000, Math.round((Number(e.target.value) || 3) * 1000)); });
  });
  panel.querySelector('#deleteLevel')?.addEventListener('click', () => deleteLevel(level.id));
  bindVariants(panel);
}

function renderRoomProps(panel, room) {
  if (!room) { renderProjectProps(panel); return; }
  const def = roomType(room.type);
  const shaft = isShaft(room);
  const minRoomSize = shaft ? MIN_SHAFT_SIZE : MIN_ROOM_SIZE;
  const parent = room.parentId ? roomById(state.project, room.parentId) : null;
  const rejected = state.rejected.get(room.id) || [];
  const insideCount = itemsInRoom(state.project, room).length;

  const furnitureRows = (def?.furniture || []).map((entry) => {
    const fd = furnitureDef(entry.kind);
    return `<div class="add-row">
      <span>${fd.title}</span><em>${fd.w}×${fd.h}</em>
      <button class="add-btn" data-add="${entry.kind}" title="Добавить в центр комнаты">+</button>
    </div>`;
  }).join('');

  const areaControl = parent && !shaft ? `
    <h3>Площадь</h3>
    <div class="prop-block">
      <label class="check-row"><input type="radio" name="areaFrom" id="areaFromParent" ${room.takesArea !== false ? 'checked' : ''}>
        <span>«${escapeHtml(room.name)}» отнимает у «${escapeHtml(parent.name)}»</span></label>
      <label class="check-row"><input type="radio" name="areaFrom" id="areaFromSelf" ${room.takesArea === false ? 'checked' : ''}>
        <span>«${escapeHtml(parent.name)}» показывается полной</span></label>
    </div>` : '';

  // Пересечения с другими комнатами: кто у кого забирает площадь (по z-порядку).
  const overlaps = overlappingTopRooms(room);
  const myIdx = state.project.rooms.indexOf(room);
  const overlapControl = overlaps.length ? `
    <h3>Пересечения</h3>
    <div class="prop-block">
      ${overlaps.map((o) => {
    const eats = myIdx > state.project.rooms.indexOf(o); // эта комната выше → съедает o
    return `<div class="prop-row overlap-row" data-other="${o.id}">
          <span>${eats ? `съедает «${escapeHtml(o.name)}»` : `«${escapeHtml(o.name)}» съедает эту`}</span>
          <button class="link" data-swap="${o.id}">поменять</button>
        </div>`;
  }).join('')}
    </div>` : '';

  const rejectedHtml = rejected.length
    ? `<div class="rejected"><h4>Не удалось расставить</h4>${rejected.map((r) => `<p>⚠ ${r.reason}</p>`).join('')}</div>`
    : '';

  panel.innerHTML = `
    <h2>${def?.title || 'Комната'}${parent ? `<span class="badge">внутри «${escapeHtml(parent.name)}»</span>` : ''}</h2>
    <div class="prop-block">
      <label class="prop-field"><span>Название</span><input id="roomName" value="${escapeHtml(room.name)}"></label>
      <div class="prop-grid">
        <label class="prop-field"><span>Ширина, мм</span><input id="roomW" type="number" step="50" min="${minRoomSize}" value="${room.w}"></label>
        <label class="prop-field"><span>Глубина, мм</span><input id="roomH" type="number" step="50" min="${minRoomSize}" value="${room.h}"></label>
      </div>
      ${shaft ? '' : `<label class="prop-field"><span>Высота потолка, м (пусто — по этажу)</span>
        <input id="roomCeil" type="number" step="0.05" min="2" placeholder="${(defaultCeiling() / 1000).toFixed(2)}" value="${room.ceiling ? (room.ceiling / 1000).toFixed(2) : ''}"></label>
      `}
      <div class="prop-row"><span>${shaft ? 'Площадь отверстия' : 'Площадь (чистая)'}</span><strong>${(shaft ? roomShapeArea(room) / 1_000_000 : roomNetAreaM2(state.project, room)).toFixed(2)} м²</strong></div>
    </div>
    ${areaControl}
    ${overlapControl}
    ${shaft ? '<div class="prop-block"><p class="empty-hint">Вертикальный проём без пола. Стены шахты строятся на всю высоту этажа.</p></div>' : ''}
    ${shaft ? '' : `<h3>Мебель <span class="count-badge">${insideCount} шт.</span></h3>
    <div class="prop-block add-list">${furnitureRows || '<p class="empty-hint">Для этого типа нет набора</p>'}</div>`}
    ${rejectedHtml}
    ${shaft ? '' : '<div class="prop-actions"><button id="arrangeBtn">Расставить мебель автоматически</button></div>'}`;

  panel.querySelector('#roomName').addEventListener('change', (e) => {
    mutate(() => { room.name = e.target.value.trim() || room.name; });
  });
  const applySize = () => {
    const w = Math.max(minRoomSize, Number(panel.querySelector('#roomW').value) || room.w);
    const h = Math.max(minRoomSize, Number(panel.querySelector('#roomH').value) || room.h);
    if (w === room.w && h === room.h) return;
    const before = snapshot();
    const old = { w: room.w, h: room.h };
    room.w = w; room.h = h;
    const verdict = resizeVerdict(room);
    if (!verdict.ok) {
      room.w = old.w; room.h = old.h;
      toast(verdict.reason, true);
      renderProps();
      return;
    }
    reconcileOpenings();
    refreshDerived();
    pushHistory(before);
    afterChange();
  };
  panel.querySelector('#roomW').addEventListener('change', applySize);
  panel.querySelector('#roomH').addEventListener('change', applySize);
  panel.querySelector('#roomCeil')?.addEventListener('change', (e) => {
    const v = Number(String(e.target.value).replace(',', '.'));
    mutate(() => { room.ceiling = v >= 2 ? Math.round(v * 1000) : null; });
  });
  panel.querySelectorAll('[data-add]').forEach((btn) => {
    btn.addEventListener('click', () => addFurniture(btn.dataset.add, room));
  });
  panel.querySelector('#arrangeBtn')?.addEventListener('click', () => {
    mutate(() => {}, { arrange: [room.id] });
    const problems = state.rejected.get(room.id) || [];
    toast(problems.length ? 'Расставлено, но есть замечания — смотрите панель' : 'Мебель расставлена');
    selectObject({ type: 'room', id: room.id });
  });
  const fromParent = panel.querySelector('#areaFromParent');
  const fromSelf = panel.querySelector('#areaFromSelf');
  if (fromParent && fromSelf) {
    fromParent.addEventListener('change', () => mutate(() => { room.takesArea = true; }));
    fromSelf.addEventListener('change', () => mutate(() => { room.takesArea = false; }));
  }
  panel.querySelectorAll('[data-swap]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const other = roomById(state.project, btn.dataset.swap);
      if (!other) return;
      mutate(() => {
        const rooms = state.project.rooms;
        const i = rooms.indexOf(room);
        const j = rooms.indexOf(other);
        [rooms[i], rooms[j]] = [rooms[j], rooms[i]];
      });
      selectObject({ type: 'room', id: room.id });
    });
  });
}

function renderWallProps(panel, wall) {
  if (!wall) { renderProjectProps(panel); return; }
  if (wall.kind === 'manual') { renderManualWallProps(panel, wall); return; }
  const roomA = roomById(state.project, wall.rooms[0]);
  const roomB = wall.rooms[1] ? roomById(state.project, wall.rooms[1]) : null;
  const length = Math.round(wall.to - wall.from);
  const subtitle = wall.kind === 'shared'
    ? `Общая стена: «${roomA?.name}» + «${roomB?.name}»`
    : roomA?.parentId ? `Перегородка «${roomA?.name}»` : `Наружная стена «${roomA?.name}»`;
  const set = state.project.settings;
  panel.innerHTML = `
    <h2>Стена</h2>
    <p class="subtitle">${subtitle}</p>
    <div class="prop-block">
      <div class="prop-row"><span>Длина</span><strong>${length} мм</strong></div>
      <label class="prop-field"><span>Толщина, мм (${WALL_T_MIN}–${WALL_T_MAX})</span>
        <input id="wallT" type="number" step="10" min="${WALL_T_MIN}" max="${WALL_T_MAX}" value="${Math.round(wall.thickness)}"></label>
      <label class="prop-field"><span>Тип</span>
        <select id="wallKind">
          <option value="partition" ${wall.wallType === 'partition' ? 'selected' : ''}>Перегородка (${wallClassThickness(set, 'partition')})</option>
          <option value="bearing" ${wall.wallType === 'bearing' ? 'selected' : ''}>Несущая (${wallClassThickness(set, 'bearing')})</option>
          <option value="exterior" ${wall.wallType === 'exterior' ? 'selected' : ''}>Наружная (${wallClassThickness(set, 'exterior')})</option>
        </select></label>
      <label class="prop-field"><span>Высота, мм (пусто — по этажу)</span>
        <input id="wallH" type="number" step="50" min="100" value="${state.project.wallOverrides?.[wall.key]?.top?.height ?? ''}"></label>
    </div>
    <p class="empty-hint">${wall.kind === 'shared'
    ? 'Общая стена двух комнат — единый объект: толщина меняется сразу для обеих, соседняя комната (и всё за ней) сдвигается, стыковка сохраняется.'
    : 'Смена типа даёт толщину этого класса, если толщина не задавалась вручную.'}</p>`;

  panel.querySelector('#wallT').addEventListener('change', (e) => {
    changeWallThickness(wall, Number(e.target.value) || wall.thickness);
  });
  panel.querySelector('#wallKind').addEventListener('change', (e) => {
    changeWallKind(wall, e.target.value);
  });
  // Своя высота стены комнаты — в wallOverrides[key] (видна в 3D).
  panel.querySelector('#wallH').addEventListener('change', (e) => {
    const v = e.target.value.trim();
    changeManualWall(wall, (project) => setWallHeight(project, wall, { height: v === '' ? null : Number(v) }));
  });
}

// Ручная стена (схема 6): объект с осью — толщина, класс, привязка оси,
// сдвиг оси, высота; проёмы ставятся кнопками «Дверь»/«Окно» над планом.
function renderManualWallProps(panel, wall) {
  const own = (state.project.walls || []).find((w) => w.id === wall.wallId);
  if (!own) { renderProjectProps(panel); return; }
  const set = state.project.settings;
  const length = Math.round(wall.to - wall.from);
  const height = own.top?.height ?? '';
  const levelH = Math.round(wall.z1 - wall.z0);
  panel.innerHTML = `
    <h2>Стена</h2>
    <p class="subtitle">Ручная стена · ${wall.orient === 'h' ? 'горизонтальная' : 'вертикальная'}</p>
    <div class="prop-block">
      <div class="prop-row"><span>Длина по оси</span><strong>${length} мм</strong></div>
      <label class="prop-field"><span>Толщина, мм (${WALL_T_MIN}–${WALL_T_MAX})</span>
        <input id="wallT" type="number" step="10" min="${WALL_T_MIN}" max="${WALL_T_MAX}" value="${Math.round(wall.thickness)}"></label>
      <label class="prop-field"><span>Тип</span>
        <select id="wallKind">
          <option value="partition" ${wall.wallType === 'partition' ? 'selected' : ''}>Перегородка (${wallClassThickness(set, 'partition')})</option>
          <option value="bearing" ${wall.wallType === 'bearing' ? 'selected' : ''}>Несущая (${wallClassThickness(set, 'bearing')})</option>
          <option value="exterior" ${wall.wallType === 'exterior' ? 'selected' : ''}>Наружная (${wallClassThickness(set, 'exterior')})</option>
        </select></label>
      <label class="prop-field"><span>Ось стены</span>
        <select id="wallJustify">
          <option value="center" ${own.justify === 'center' ? 'selected' : ''}>По центру</option>
          <option value="left" ${own.justify === 'left' ? 'selected' : ''}>По левой грани</option>
          <option value="right" ${own.justify === 'right' ? 'selected' : ''}>По правой грани</option>
        </select></label>
      <label class="prop-field"><span>Сдвинуть ось на, мм (${wall.orient === 'h' ? '+ вниз' : '+ вправо'})</span>
        <input id="wallShift" type="number" step="10" value="0"></label>
      <label class="prop-field"><span>Высота, мм (пусто — по этажу, ${levelH})</span>
        <input id="wallH" type="number" step="50" min="100" value="${height}"></label>
    </div>
    <p class="empty-hint">Тяните стену — сдвиг, круглые ручки на концах — длина. Примыкающие ручные стены едут вместе. Del — удалить вместе с проёмами.</p>`;

  panel.querySelector('#wallT').addEventListener('change', (e) => changeWallThickness(wall, Number(e.target.value) || wall.thickness));
  panel.querySelector('#wallKind').addEventListener('change', (e) => changeWallKind(wall, e.target.value));
  panel.querySelector('#wallJustify').addEventListener('change', (e) => {
    changeManualWall(wall, (project, id) => setManualWallJustify(project, id, e.target.value));
  });
  panel.querySelector('#wallShift').addEventListener('change', (e) => {
    const delta = Number(e.target.value) || 0;
    if (delta) changeManualWall(wall, (project, id) => moveManualWall(project, id, delta));
  });
  panel.querySelector('#wallH').addEventListener('change', (e) => {
    const v = e.target.value.trim();
    changeManualWall(wall, (project) => setWallHeight(project, wall, { height: v === '' ? null : Number(v) }));
  });
}

// Фасад проёма (вид на стену) — SVG с размерами ширины, высоты и отступа
// от пола. Чисто параметрический, масштабируется.
function elevationSVG(opening) {
  const isDoor = opening.kind === 'door';
  const sill = isDoor ? 0 : (opening.sill || 0);
  const height = opening.height || (isDoor ? 2100 : 1500);
  const width = opening.width;
  const ceil = Math.max(2700, sill + height + 350);
  const margin = Math.max(500, width * 0.35);
  const W = width + margin * 2;
  const ox = margin;
  const oy = ceil - sill - height;
  const sw = Math.max(14, W / 90); // толщина линий в единицах viewBox
  const dim = (x1, y1, x2, y2, label, tx, ty, rot) => `
    <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="elev-dim"/>
    <text x="${tx}" y="${ty}" class="elev-txt" ${rot ? `transform="rotate(${rot} ${tx} ${ty})"` : ''}>${label}</text>`;
  const glass = isDoor
    ? `<rect x="${ox + sw * 1.5}" y="${oy + sw * 1.5}" width="${width - sw * 3}" height="${height - sw * 3}" class="elev-door"/>
       <circle cx="${ox + width - sw * 5}" cy="${oy + height / 2}" r="${sw * 1.5}" class="elev-dim"/>`
    : `<rect x="${ox}" y="${oy}" width="${width}" height="${height}" class="elev-glass"/>
       <line x1="${ox + width / 2}" y1="${oy}" x2="${ox + width / 2}" y2="${oy + height}" class="elev-dim"/>
       <line x1="${ox}" y1="${oy + height / 2}" x2="${ox + width}" y2="${oy + height / 2}" class="elev-dim"/>`;
  return `<svg viewBox="0 0 ${W} ${ceil}" class="elev" preserveAspectRatio="xMidYMid meet" style="--sw:${sw}px">
    <rect x="0" y="0" width="${W}" height="${ceil}" class="elev-wall"/>
    <rect x="${ox}" y="${oy}" width="${width}" height="${height}" class="elev-open"/>
    ${glass}
    <line x1="0" y1="${ceil}" x2="${W}" y2="${ceil}" class="elev-floor"/>
    ${dim(ox, oy - sw * 6, ox + width, oy - sw * 6, `${width}`, ox + width / 2, oy - sw * 8)}
    ${dim(ox + width + sw * 6, oy, ox + width + sw * 6, oy + height, `${height}`, ox + width + sw * 10, oy + height / 2, -90)}
    ${sill > 0 ? dim(ox - sw * 6, oy + height, ox - sw * 6, ceil, `${sill}`, ox - sw * 10, oy + height + sill / 2, -90) : ''}
  </svg>`;
}

function renderOpeningProps(panel, opening) {
  if (!opening) { renderProjectProps(panel); return; }
  const room = roomById(state.project, opening.roomId);
  const isDoor = opening.kind === 'door';
  const walls = state.walls;
  const frame = openingFrame(state.project, opening, walls);
  const placed = openingRect(state.project, opening, walls);
  let leftGap = null;
  let rightGap = null;
  let wall = null;
  if (placed) {
    wall = placed.wall;
    const centerAlong = wall.orient === 'h' ? placed.rect.x + placed.rect.w / 2 : placed.rect.y + placed.rect.h / 2;
    leftGap = Math.round((centerAlong - opening.width / 2) - wall.from);
    rightGap = Math.round(wall.to - (centerAlong + opening.width / 2));
  }

  panel.innerHTML = `
    <h2>${isDoor ? 'Дверь' : 'Окно'}</h2>
    <p class="subtitle">${opening.host ? 'Ручная стена' : `Стена «${room?.name}»`}</p>
    <div class="elev-wrap">${elevationSVG(opening)}</div>
    <div class="prop-block">
      <label class="prop-field"><span>Тип</span>
        <select id="openType">${Object.entries(isDoor ? DOOR_TYPES : WINDOW_TYPES).map(([id, title]) => `
          <option value="${id}" ${(opening.type || (isDoor ? 'single' : 'standard')) === id ? 'selected' : ''}>${title}</option>`).join('')}
        </select></label>
      <div class="prop-grid">
        <label class="prop-field"><span>Ширина, мм</span>
          <input id="openW" type="number" step="50" min="300" value="${opening.width}"></label>
        <label class="prop-field"><span>Высота, мм</span>
          <input id="openH" type="number" step="50" min="300" value="${opening.height || (isDoor ? 2100 : 1500)}"></label>
      </div>
      ${isDoor ? '' : `<label class="prop-field"><span>Отступ от пола (подоконник), мм</span>
        <input id="openSill" type="number" step="50" min="0" value="${opening.sill || 0}"></label>`}
    </div>
    <h3>Положение на стене</h3>
    <div class="prop-block">
      <div class="prop-grid">
        <label class="prop-field"><span>Отступ слева, мм</span>
          <input id="gapL" type="number" step="50" value="${leftGap ?? ''}" ${leftGap === null ? 'disabled' : ''}></label>
        <label class="prop-field"><span>Отступ справа, мм</span>
          <input id="gapR" type="number" step="50" value="${rightGap ?? ''}" ${rightGap === null ? 'disabled' : ''}></label>
      </div>
      <label class="prop-field"><span>От начала стены, мм</span>
        <input id="openOff" type="number" step="50" value="${Math.round(openingPos(opening))}"></label>
    </div>
    ${isDoor ? '<p class="empty-hint">Петли и направление открывания меняются в единой панели над планом.</p>' : ''}`;

  const commitOpening = (fn) => {
    mutate(fn);
    selectObject({ type: 'opening', id: opening.id });
  };
  panel.querySelector('#openW').addEventListener('change', (e) => {
    const width = Math.max(300, Number(e.target.value) || opening.width);
    commitOpening(() => {
      opening.width = width;
      const clamped = fitOpeningOffset(state.project, opening, deriveWalls(state.project), openingPos(opening));
      if (clamped !== null) setOpeningPos(opening, clamped);
      else toast('Проём шире свободного участка стены (с зазором 100 мм до соседних) — уменьшите ширину');
    });
  });
  panel.querySelector('#openType').addEventListener('change', (e) => {
    const type = e.target.value;
    commitOpening(() => {
      opening.type = type;
      if (!isDoor) {
        // Панорамное — почти от пола и выше; обычное — подоконник 900, 1500.
        const top = activeLevel(state.project).height - 400;
        if (type === 'panoramic') { opening.sill = 100; opening.height = Math.min(2400, top - 100); }
        else { opening.sill = 900; opening.height = Math.min(1500, top - 900); }
      } else if (type === 'double' && opening.width < 1200) {
        opening.width = 1200; // двустворчатой нужна ширина
      }
    });
  });
  panel.querySelector('#openH').addEventListener('change', (e) => {
    commitOpening(() => { opening.height = Math.max(300, Number(e.target.value) || opening.height); });
  });
  const sillInput = panel.querySelector('#openSill');
  if (sillInput) sillInput.addEventListener('change', (e) => commitOpening(() => { opening.sill = Math.max(0, Number(e.target.value) || 0); }));

  const setByGap = (fromLeft) => (e) => {
    if (!wall || !frame) return;
    const value = Math.max(0, Number(e.target.value) || 0);
    const along = fromLeft ? wall.from + opening.width / 2 + value : wall.to - opening.width / 2 - value;
    const desired = (along - frame.base) * frame.dir;
    commitOpening(() => {
      const clamped = fitOpeningOffset(state.project, opening, deriveWalls(state.project), desired);
      if (clamped !== null) setOpeningPos(opening, clamped);
      else toast('Сюда проём не помещается: мало места или налезает на соседний проём');
    });
  };
  if (leftGap !== null) panel.querySelector('#gapL').addEventListener('change', setByGap(true));
  if (rightGap !== null) panel.querySelector('#gapR').addEventListener('change', setByGap(false));
  panel.querySelector('#openOff').addEventListener('change', (e) => {
    commitOpening(() => {
      const clamped = fitOpeningOffset(state.project, opening, deriveWalls(state.project), Number(e.target.value) || openingPos(opening));
      if (clamped !== null) setOpeningPos(opening, clamped);
      else toast('Сюда проём не помещается: мало места или налезает на соседний проём');
    });
  });
}

// Лестничная зона следует за габаритом марша: смена формы остаётся операцией
// в один клик и никогда не выпускает ступени сквозь стены.
function fitStairRoom(item, margin = 200) {
  const room = state.project.rooms.find((candidate) => candidate.type === 'stairs-room'
    && item.x >= candidate.x && item.x <= candidate.x + candidate.w
    && item.y >= candidate.y && item.y <= candidate.y + candidate.h);
  if (!room) return;
  room.w = item.w + margin * 2;
  room.h = item.h + margin * 2;
  room.x = item.x - room.w / 2;
  room.y = item.y - room.h / 2;
}

function renderItemProps(panel, item) {
  if (!item) { renderProjectProps(panel); return; }
  const isStairs = item.kind === 'stairs';
  const fixed = isFixedSizeComp(item);
  let stairsBlock = '';
  if (isStairs) {
    const c = stairCalculation(item, activeLevel(state.project)?.height || 3000);
    const comfortable = c.okRiser && c.okTread && c.okComfort;
    stairsBlock = `
      <h3>Форма лестницы</h3>
      <div class="stair-shape">
        ${STAIR_SHAPES.map((shape) => `<button type="button" data-stair-shape="${shape.id}" class="${c.shape === shape.id ? 'active' : ''}">${shape.title}</button>`).join('')}
      </div>
      <button id="stairFit" type="button">Подогнать автоматически</button>
      <h3>Простой расчёт</h3>
      <div class="prop-block">
        <label class="prop-field"><span>Высота этажа, мм</span>
          <input id="floorH" type="number" step="50" min="2000" value="${c.floorH}"></label>
        <div class="prop-row"><span>Подступенков</span><strong>${c.risers}</strong></div>
        <div class="prop-row"><span>Проступей</span><strong>${c.treads}</strong></div>
        <div class="prop-row"><span>Высота ступени</span><strong class="${c.okRiser ? '' : 'bad'}">${Math.round(c.riserH)} мм</strong></div>
        <div class="prop-row"><span>Глубина проступи</span><strong class="${c.okTread ? '' : 'bad'}">${Math.round(c.treadD)} мм</strong></div>
        <div class="prop-row"><span>Формула удобства</span><strong class="${c.okComfort ? '' : 'bad'}">${Math.round(c.comfort)} мм</strong></div>
        <p class="empty-hint">${comfortable ? '✓ Размеры лестницы удобные.' : 'Нажмите «Подогнать автоматически» — размеры станут удобными.'} Норма: ступень 150–190, проступь 230–340 мм.</p>
      </div>`;
  }
  panel.innerHTML = `
    <h2>${itemTitle(item.kind)}</h2>
    <p class="subtitle">${isStairs ? 'Выберите форму — размеры и ступени рассчитаются автоматически. Стрелка показывает подъём.' : fixed && item.comp?.type === 'kitchen' ? 'Кухня-конструктор: форма, длины и элементы — ниже; элементы тянутся на плане' : fixed ? 'Собирается из модулей: «+» на концах дивана или список ниже' : item.comp ? 'Размер — столешница; стулья расставляются по сторонам сами' : 'Свободный объект: перетаскивается куда угодно, едет вместе с комнатой'}</p>
    <div class="prop-block">
      <div class="prop-grid">
        <label class="prop-field"><span>${isStairs ? 'Габарит по X, мм' : fixed ? 'Общая ширина, мм' : 'Ширина, мм'}</span><input id="itemW" type="number" step="50" min="200" value="${item.w}" ${fixed ? 'readonly' : ''}></label>
        <label class="prop-field"><span>${isStairs ? 'Габарит по Y, мм' : fixed ? 'Общая глубина, мм' : 'Глубина, мм'}</span><input id="itemH" type="number" step="50" min="200" value="${item.h}" ${fixed ? 'readonly' : ''}></label>
      </div>
      <div class="prop-row"><span>Поворот</span><strong>${item.rotation || 0}°</strong></div>
    </div>
    ${stairsBlock}
    ${compositeSection(item)}
    <p class="empty-hint">Копирование, поворот, отражение и удаление — в единой панели над планом.</p>`;
  const applySize = () => {
    if (fixed) return; // диван-конструктор: размер — по модулям
    const w = Math.max(200, Number(panel.querySelector('#itemW').value) || item.w);
    const h = Math.max(200, Number(panel.querySelector('#itemH').value) || item.h);
    mutate(() => {
      item.w = w; item.h = h;
      if (isStairs) fitStairRoom(item);
    });
    if (isStairs || item.comp) selectObject({ type: 'item', id: item.id });
  };
  panel.querySelector('#itemW').addEventListener('change', applySize);
  panel.querySelector('#itemH').addEventListener('change', applySize);
  const fh = panel.querySelector('#floorH');
  if (fh) fh.addEventListener('change', (e) => {
    mutate(() => {
      applyStairPreset(item, stairShape(item), Math.max(2000, Number(e.target.value) || 3000));
      fitStairRoom(item);
      reconcileOpenings();
    });
    selectObject({ type: 'item', id: item.id });
  });
  panel.querySelectorAll('[data-stair-shape]').forEach((button) => {
    button.addEventListener('click', () => {
      mutate(() => {
        applyStairPreset(item, button.dataset.stairShape, item.floorHeight || activeLevel(state.project)?.height || 3000);
        fitStairRoom(item);
        reconcileOpenings();
      });
      selectObject({ type: 'item', id: item.id });
    });
  });
  panel.querySelector('#stairFit')?.addEventListener('click', () => {
    mutate(() => {
      applyStairPreset(item, stairShape(item), item.floorHeight || activeLevel(state.project)?.height || 3000);
      fitStairRoom(item);
      reconcileOpenings();
    });
    selectObject({ type: 'item', id: item.id });
    toast('Лестница подогнана под высоту этажа');
  });
  bindCompositeSection(panel, item);
}

function renderMultiProps(panel, sel) {
  panel.innerHTML = `
    <h2>Выделено</h2>
    <div class="prop-block">
      <div class="prop-row"><span>Комнат</span><strong>${sel.roomIds.length}</strong></div>
      <div class="prop-row"><span>Мебели</span><strong>${sel.itemIds.length}</strong></div>
    </div>
    <p class="empty-hint">Shift-клик добавляет или убирает объект. Все действия с выделением находятся в панели над планом.</p>`;
}

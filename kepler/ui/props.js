// Правая панель свойств: проект, комната, стена, проём, мебель, группа.

import { furnitureDef, roomType } from '../core/catalog.js';
import { itemTitle, itemsInRoom } from '../core/furnish.js';
import { activeLevel, levelProject, roomById } from '../core/model.js';
import { SP55 } from '../core/norms.js';
import { MIN_ROOM_SIZE, roomNetAreaM2, totalAreaM2 } from '../core/rooms.js';
import {
  DOOR_TYPES, MAX_SHARED_GAP, WINDOW_TYPES, clampOpeningOffset, deriveWalls, openingRect,
} from '../core/walls.js';
import { escapeHtml, refs, toast } from './dom.js';
import { findWall } from './hit.js';
import { deleteLevel } from './levels.js';
import { syncMobileBar } from './mobile.js';
import { bindNormLinks, normsSection, roomNormsBlock } from './norms-view.js';
import {
  addFurniture, changeWallThickness, deleteSelection, overlappingTopRooms, reconcileOpenings,
  rotateMulti90, rotateSelectedItem,
} from './plan-actions.js';
import {
  bindBuildingRotation, buildingRotationField, renderSiteObjectProps, renderSiteSettings,
} from './props-site.js';
import { resizeVerdict } from './snap.js';
import { state } from './state.js';
import { afterChange, mutate, pushHistory, refreshDerived, snapshot } from './store.js';
import { selectObject, startPlaceOpening } from './tools.js';

export function renderProps() {
  syncMobileBar();
  const sel = state.selection;
  const panel = refs.props;
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
    ${normsSection()}
    <h3>Управление</h3>
    <ul class="hotkeys">
      <li><b>ЛКМ</b> — выделение, рамка по пустому месту</li>
      <li><b>ПКМ / средняя / пробел</b> — панорама, <b>колесо</b> — масштаб</li>
      <li><b>Del</b> — удалить, <b>R</b> — повернуть мебель</li>
      <li><b>Ctrl+Z / Ctrl+Shift+Z</b> — отмена / повтор</li>
      <li><b>Стрелки</b> — сдвиг на 50 мм (Shift — 500)</li>
      <li><b>PgUp / PgDn</b> — этаж выше / ниже</li>
    </ul>`;
  panel.querySelectorAll('[data-room]').forEach((btn) => {
    btn.addEventListener('click', () => selectObject({ type: 'room', id: btn.dataset.room }));
  });
  bindBuildingRotation(panel);
  panel.querySelector('#unitsSel').addEventListener('change', (e) => {
    mutate(() => { state.project.settings.units = e.target.value === 'm' ? 'm' : 'mm'; });
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
  bindNormLinks(panel);
}

function renderRoomProps(panel, room) {
  if (!room) { renderProjectProps(panel); return; }
  const def = roomType(room.type);
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

  const areaControl = parent ? `
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
        <label class="prop-field"><span>Ширина, мм</span><input id="roomW" type="number" step="50" min="${MIN_ROOM_SIZE}" value="${room.w}"></label>
        <label class="prop-field"><span>Глубина, мм</span><input id="roomH" type="number" step="50" min="${MIN_ROOM_SIZE}" value="${room.h}"></label>
      </div>
      <label class="prop-field"><span>Высота потолка, м (пусто — по этажу)</span>
        <input id="roomCeil" type="number" step="0.05" min="2" placeholder="${(defaultCeiling() / 1000).toFixed(2)}" value="${room.ceiling ? (room.ceiling / 1000).toFixed(2) : ''}"></label>
      <div class="prop-row"><span>Площадь (чистая)</span><strong>${roomNetAreaM2(state.project, room).toFixed(2)} м²</strong></div>
    </div>
    ${areaControl}
    ${overlapControl}
    ${roomNormsBlock(room.id)}
    <h3>Мебель <span class="count-badge">${insideCount} шт.</span></h3>
    <div class="prop-block add-list">${furnitureRows || '<p class="empty-hint">Для этого типа нет набора</p>'}</div>
    ${rejectedHtml}
    <div class="prop-actions">
      <button id="arrangeBtn">Расставить мебель автоматически</button>
      <button id="addDoorBtn">+ Дверь</button>
      <button id="addWindowBtn">+ Окно</button>
      <button id="deleteRoomBtn" class="danger">Удалить комнату</button>
    </div>`;

  panel.querySelector('#roomName').addEventListener('change', (e) => {
    mutate(() => { room.name = e.target.value.trim() || room.name; });
  });
  const applySize = () => {
    const w = Math.max(MIN_ROOM_SIZE, Number(panel.querySelector('#roomW').value) || room.w);
    const h = Math.max(MIN_ROOM_SIZE, Number(panel.querySelector('#roomH').value) || room.h);
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
  panel.querySelector('#roomCeil').addEventListener('change', (e) => {
    const v = Number(String(e.target.value).replace(',', '.'));
    mutate(() => { room.ceiling = v >= 2 ? Math.round(v * 1000) : null; });
  });
  panel.querySelectorAll('[data-add]').forEach((btn) => {
    btn.addEventListener('click', () => addFurniture(btn.dataset.add, room));
  });
  panel.querySelector('#arrangeBtn').addEventListener('click', () => {
    mutate(() => {}, { arrange: [room.id] });
    const problems = state.rejected.get(room.id) || [];
    toast(problems.length ? 'Расставлено, но есть замечания — смотрите панель' : 'Мебель расставлена');
    selectObject({ type: 'room', id: room.id });
  });
  panel.querySelector('#addDoorBtn').addEventListener('click', () => startPlaceOpening('door'));
  panel.querySelector('#addWindowBtn').addEventListener('click', () => startPlaceOpening('window'));
  panel.querySelector('#deleteRoomBtn').addEventListener('click', deleteSelection);
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
  const roomA = roomById(state.project, wall.rooms[0]);
  const roomB = wall.rooms[1] ? roomById(state.project, wall.rooms[1]) : null;
  const length = Math.round(wall.to - wall.from);
  const subtitle = wall.kind === 'shared'
    ? `Общая стена: «${roomA?.name}» + «${roomB?.name}»`
    : roomA?.parentId ? `Перегородка «${roomA?.name}»` : `Наружная стена «${roomA?.name}»`;
  const maxT = wall.kind === 'shared' ? MAX_SHARED_GAP : 600;
  panel.innerHTML = `
    <h2>Стена</h2>
    <p class="subtitle">${subtitle}</p>
    <div class="prop-block">
      <div class="prop-row"><span>Длина</span><strong>${length} мм</strong></div>
      <label class="prop-field"><span>Толщина, мм (50–${maxT})</span>
        <input id="wallT" type="number" step="10" min="50" max="${maxT}" value="${Math.round(wall.thickness)}"></label>
      <label class="prop-field"><span>Тип</span>
        <select id="wallKind">
          <option value="partition" ${wall.wallType === 'partition' ? 'selected' : ''}>Перегородка</option>
          <option value="bearing" ${wall.wallType === 'bearing' ? 'selected' : ''}>Несущая</option>
          <option value="exterior" ${wall.wallType === 'exterior' ? 'selected' : ''}>Наружная</option>
        </select></label>
    </div>
    <div class="prop-actions">
      <button id="wallDoorBtn">+ Дверь в этой стене</button>
      <button id="wallWindowBtn" ${wall.kind === 'shared' || roomA?.parentId ? 'disabled title="Окна — только на наружных стенах"' : ''}>+ Окно в этой стене</button>
    </div>
    <p class="empty-hint">Общая стена двух комнат — единый объект: толщина меняется сразу для обеих, соседняя комната сдвигается.</p>`;

  panel.querySelector('#wallT').addEventListener('change', (e) => {
    const newT = Math.min(maxT, Math.max(50, Number(e.target.value) || wall.thickness));
    changeWallThickness(wall, newT);
  });
  panel.querySelector('#wallKind').addEventListener('change', (e) => {
    mutate(() => {
      state.project.wallOverrides[wall.key] = { ...(state.project.wallOverrides[wall.key] || {}), kind: e.target.value };
    });
    selectObject({ type: 'wall', key: wall.key, from: wall.from });
  });
  panel.querySelector('#wallDoorBtn').addEventListener('click', () => startPlaceOpening('door', { key: wall.key, from: wall.from }));
  const windowBtn = panel.querySelector('#wallWindowBtn');
  if (!windowBtn.disabled) windowBtn.addEventListener('click', () => startPlaceOpening('window', { key: wall.key, from: wall.from }));
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
    <p class="subtitle">Стена «${room?.name}»</p>
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
        <input id="openOff" type="number" step="50" value="${Math.round(opening.offset)}"></label>
    </div>
    ${isDoor && ['single', 'double', undefined].includes(opening.type) ? `
    <div class="prop-actions">
      <button id="flipSwing">Открывание: ${opening.swingIn ? 'внутрь' : 'наружу'}</button>
      <button id="flipHinge">Петли: ${opening.hingeStart ? 'слева' : 'справа'}</button>
    </div>` : ''}
    <div class="prop-actions">
      <button id="deleteOpening" class="danger">Удалить ${isDoor ? 'дверь' : 'окно'}</button>
    </div>`;

  const commitOpening = (fn) => {
    mutate(fn);
    selectObject({ type: 'opening', id: opening.id });
  };
  panel.querySelector('#openW').addEventListener('change', (e) => {
    const width = Math.max(300, Number(e.target.value) || opening.width);
    commitOpening(() => {
      opening.width = width;
      const clamped = clampOpeningOffset(state.project, opening, deriveWalls(state.project), opening.offset);
      if (clamped !== null) opening.offset = clamped;
      else toast('Проём шире стены — уменьшите ширину');
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
    if (!wall) return;
    const base = wall.orient === 'h'
      ? roomById(state.project, opening.roomId).x
      : roomById(state.project, opening.roomId).y;
    const value = Math.max(0, Number(e.target.value) || 0);
    const desired = fromLeft
      ? (wall.from - base) + opening.width / 2 + value
      : (wall.to - base) - opening.width / 2 - value;
    commitOpening(() => {
      const clamped = clampOpeningOffset(state.project, opening, deriveWalls(state.project), desired);
      if (clamped !== null) opening.offset = clamped;
      else toast('Сюда проём не помещается');
    });
  };
  if (leftGap !== null) panel.querySelector('#gapL').addEventListener('change', setByGap(true));
  if (rightGap !== null) panel.querySelector('#gapR').addEventListener('change', setByGap(false));
  panel.querySelector('#openOff').addEventListener('change', (e) => {
    commitOpening(() => {
      const clamped = clampOpeningOffset(state.project, opening, deriveWalls(state.project), Number(e.target.value) || opening.offset);
      if (clamped !== null) opening.offset = clamped;
      else toast('Сюда проём не помещается');
    });
  });
  if (isDoor) {
    panel.querySelector('#flipSwing').addEventListener('click', () => commitOpening(() => { opening.swingIn = !opening.swingIn; }));
    panel.querySelector('#flipHinge').addEventListener('click', () => commitOpening(() => { opening.hingeStart = !opening.hingeStart; }));
  }
  panel.querySelector('#deleteOpening').addEventListener('click', deleteSelection);
}

// Расчёт лестницы по высоте этажа и длине марша (как калькулятор в Revit).
function stairCalc(item) {
  const floorH = item.floorHeight || 3000;
  const run = item.h; // длина марша (глубина предмета)
  const idealRiser = 170; // комфортный подступенок
  const risers = Math.max(2, Math.round(floorH / idealRiser));
  const riserH = floorH / risers;
  const treads = risers - 1; // проступей на один меньше подступенков
  const treadD = treads > 0 ? run / treads : run;
  // Правило удобства: 2·подступенок + проступь ≈ 600–640 мм.
  const comfort = 2 * riserH + treadD;
  const neededRun = treads * 280; // при проступи 280 мм
  const okRiser = riserH >= 150 && riserH <= 190;
  const okTread = treadD >= 230 && treadD <= 340;
  return { floorH, run, risers, riserH, treads, treadD, comfort, neededRun, okRiser, okTread };
}

function renderItemProps(panel, item) {
  if (!item) { renderProjectProps(panel); return; }
  const isStairs = item.kind === 'stairs';
  let stairsBlock = '';
  if (isStairs) {
    const c = stairCalc(item);
    const diff = Math.round(c.neededRun - c.run);
    const diffText = Math.abs(diff) < 50 ? 'длина марша оптимальна'
      : diff > 0 ? `марш короче нужного на ${diff} мм — добавьте длину` : `марш длиннее нужного на ${-diff} мм`;
    stairsBlock = `
      <h3>Расчёт лестницы</h3>
      <div class="prop-block">
        <label class="prop-field"><span>Высота этажа, мм</span>
          <input id="floorH" type="number" step="50" min="2000" value="${c.floorH}"></label>
        <div class="prop-row"><span>Подступенков</span><strong>${c.risers}</strong></div>
        <div class="prop-row"><span>Проступей</span><strong>${c.treads}</strong></div>
        <div class="prop-row"><span>Высота ступени</span><strong class="${c.okRiser ? '' : 'bad'}">${Math.round(c.riserH)} мм</strong></div>
        <div class="prop-row"><span>Глубина проступи</span><strong class="${c.okTread ? '' : 'bad'}">${Math.round(c.treadD)} мм</strong></div>
        <div class="prop-row"><span>Формула удобства</span><strong>${Math.round(c.comfort)} мм</strong></div>
        <p class="empty-hint">${diffText}. Комфортно: ступень 150–190, проступь 230–340, формула 600–640 мм.</p>
      </div>`;
  }
  panel.innerHTML = `
    <h2>${itemTitle(item.kind)}</h2>
    <p class="subtitle">${isStairs ? 'Длина предмета = длина марша; тяните углы или меняйте ниже' : 'Свободный объект: перетаскивается куда угодно, едет вместе с комнатой'}</p>
    <div class="prop-block">
      <div class="prop-grid">
        <label class="prop-field"><span>Ширина, мм</span><input id="itemW" type="number" step="50" min="200" value="${item.w}"></label>
        <label class="prop-field"><span>${isStairs ? 'Длина марша, мм' : 'Глубина, мм'}</span><input id="itemH" type="number" step="50" min="200" value="${item.h}"></label>
      </div>
      <div class="prop-row"><span>Поворот</span><strong>${item.rotation || 0}°</strong></div>
    </div>
    ${stairsBlock}
    <div class="prop-actions">
      <button id="rotateItem">Повернуть на 90° (R)</button>
      <button id="deleteItem" class="danger">Удалить</button>
    </div>`;
  const applySize = () => {
    const w = Math.max(200, Number(panel.querySelector('#itemW').value) || item.w);
    const h = Math.max(200, Number(panel.querySelector('#itemH').value) || item.h);
    mutate(() => { item.w = w; item.h = h; });
    if (isStairs) selectObject({ type: 'item', id: item.id });
  };
  panel.querySelector('#itemW').addEventListener('change', applySize);
  panel.querySelector('#itemH').addEventListener('change', applySize);
  const fh = panel.querySelector('#floorH');
  if (fh) fh.addEventListener('change', (e) => {
    mutate(() => { item.floorHeight = Math.max(2000, Number(e.target.value) || 3000); });
    selectObject({ type: 'item', id: item.id });
  });
  panel.querySelector('#rotateItem').addEventListener('click', rotateSelectedItem);
  panel.querySelector('#deleteItem').addEventListener('click', deleteSelection);
}

function renderMultiProps(panel, sel) {
  const items = sel.itemIds.map((id) => state.project.items.find((i) => i.id === id)).filter(Boolean);
  const groups = new Set(items.map((i) => i.group).filter(Boolean));
  const grouped = items.length >= 2 && groups.size === 1 && items.every((i) => i.group) && groups.size;
  panel.innerHTML = `
    <h2>Выделено</h2>
    <div class="prop-block">
      <div class="prop-row"><span>Комнат</span><strong>${sel.roomIds.length}</strong></div>
      <div class="prop-row"><span>Мебели</span><strong>${sel.itemIds.length}</strong></div>
    </div>
    <p class="empty-hint">Shift-клик добавляет/убирает объект. Перетащите любой — поедут все. R — повернуть мебель группой на 90°. Del — удалить.</p>
    <div class="prop-actions">
      ${items.length >= 2 ? `<button id="rotateMulti">Повернуть мебель на 90° (R)</button>` : ''}
      ${items.length >= 2 && !grouped ? `<button id="groupBtn">Объединить в группу</button>` : ''}
      ${grouped ? `<button id="ungroupBtn">Разгруппировать</button>` : ''}
      <button id="deleteMulti" class="danger">Удалить выделенное</button>
    </div>`;
  const rot = panel.querySelector('#rotateMulti');
  if (rot) rot.addEventListener('click', rotateMulti90);
  const groupBtn = panel.querySelector('#groupBtn');
  if (groupBtn) groupBtn.addEventListener('click', () => {
    const gid = `grp-${Date.now().toString(36)}`;
    mutate(() => { for (const i of items) i.group = gid; });
    selectObject(sel);
    toast('Мебель объединена в группу — клик по любому выделит всю группу');
  });
  const ungroupBtn = panel.querySelector('#ungroupBtn');
  if (ungroupBtn) ungroupBtn.addEventListener('click', () => {
    mutate(() => { for (const i of items) delete i.group; });
    selectObject(sel);
    toast('Группа расформирована');
  });
  panel.querySelector('#deleteMulti').addEventListener('click', deleteSelection);
}

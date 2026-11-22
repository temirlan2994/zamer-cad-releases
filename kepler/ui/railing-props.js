// Панель «Свойства» перил: выбранный сегмент (тип, высота, длина, положение)
// и блок «Перила» у открытой комнаты (перила по сторонам).

import {
  RAILING_MAX_HEIGHT, RAILING_MIN_HEIGHT, RAILING_TYPES, railingList, sideHasRailing, sideLength,
} from '../core/railings.js';
import { isOpenRoom } from '../core/catalog.js';
import { escapeHtml } from './dom.js';
import {
  deleteSelectedRailing, selectedRailing, setRoomSideRailing, setSelectedRailingProps, setSelectedRailingRange,
  splitSelectedRailing,
} from './railing-actions.js';
import { state } from './state.js';

const SIDE_TITLES = ['Сверху', 'Справа', 'Снизу', 'Слева'];

// Выбранный сегмент перил. false — нечего показать.
export function renderRailingProps(panel) {
  const hit = selectedRailing();
  if (!hit) return false;
  const { room, seg } = hit;
  const len = Math.round(seg.to - seg.from);
  const max = Math.round(sideLength(room, seg.side));
  panel.innerHTML = `
    <h2>Перила<span class="badge">«${escapeHtml(room.name)}», ${SIDE_TITLES[seg.side].toLowerCase()}</span></h2>
    <div class="prop-block">
      <label class="prop-field"><span>Тип</span>
        <select id="railType">${RAILING_TYPES.map((t) => `<option value="${t.id}" ${t.id === seg.type ? 'selected' : ''}>${t.title}</option>`).join('')}</select></label>
      <label class="prop-field"><span>Высота, мм</span>
        <input id="railHeight" type="number" step="50" min="${RAILING_MIN_HEIGHT}" max="${RAILING_MAX_HEIGHT}" value="${seg.height}"></label>
      <div class="prop-grid">
        <label class="prop-field"><span>Длина, мм</span><input id="railLength" type="number" step="50" min="50" max="${max}" value="${len}"></label>
        <label class="prop-field"><span>От начала стороны, мм</span><input id="railFrom" type="number" step="50" min="0" max="${max}" value="${Math.round(seg.from)}"></label>
      </div>
      <p class="empty-hint">Сторона ${max} мм. Концы перил тянутся ручками на плане (Shift — без шага).</p>
    </div>
    <div class="prop-actions">
      <button id="railSplit">Разделить</button>
      <button id="railDelete" class="danger">Удалить</button>
    </div>`;
  panel.querySelector('#railType').addEventListener('change', (e) => setSelectedRailingProps({ type: e.target.value }));
  panel.querySelector('#railHeight').addEventListener('change', (e) => setSelectedRailingProps({ height: Number(e.target.value) }));
  panel.querySelector('#railLength').addEventListener('change', (e) => setSelectedRailingRange({ length: Number(e.target.value) || len }));
  panel.querySelector('#railFrom').addEventListener('change', (e) => setSelectedRailingRange({ from: Number(e.target.value) || 0 }));
  panel.querySelector('#railSplit').addEventListener('click', () => splitSelectedRailing());
  panel.querySelector('#railDelete').addEventListener('click', () => deleteSelectedRailing());
  return true;
}

// Блок «Перила» в свойствах открытой комнаты: флажки по сторонам.
export function roomRailingsHtml(room) {
  if (!isOpenRoom(room)) return '';
  const list = railingList(room, state.project.rooms, state.project.settings);
  return `
    <h3>Перила</h3>
    <div class="prop-block" id="roomRailings">
      ${SIDE_TITLES.map((title, side) => `<label class="check-row"><input type="checkbox" data-rail-side="${side}" ${sideHasRailing(list, side) ? 'checked' : ''}>
        <span>Перила на этой стороне: ${title.toLowerCase()}</span></label>`).join('')}
      <p class="empty-hint">Сегмент перил выбирается кликом на плане: тип, высота, длина, разрыв.</p>
    </div>`;
}

export function bindRoomRailings(panel, room) {
  panel.querySelectorAll('[data-rail-side]').forEach((box) => {
    box.addEventListener('change', () => setRoomSideRailing(room.id, Number(box.dataset.railSide), box.checked));
  });
}

// Поле ввода размера по клику на размерную линию.

import { roomById } from '../core/model.js';
import { clampOpeningOffset, deriveWalls, openingRect } from '../core/walls.js';
import { el, toast } from './dom.js';
import { state } from './state.js';
import { mutate } from './store.js';
import { selectObject } from './tools.js';

// Инлайн-ввод размера (отступа до стены) прямо на размерной линии.
export function openDimInput(dim) {
  const overlay = el('dimInput');
  const input = el('dimInputField');
  state.dimEdit = { openingId: state.selection.id, kind: dim.kind };
  input.value = Math.round(dim.gap);
  overlay.style.left = `${dim.x}px`;
  overlay.style.top = `${dim.y}px`;
  overlay.hidden = false;
  setTimeout(() => { input.focus(); input.select(); }, 20);
}

export function hideDimInput() {
  el('dimInput').hidden = true;
  state.dimEdit = null;
}

export function applyDimInput() {
  const edit = state.dimEdit;
  if (!edit) return;
  const opening = state.project.openings.find((o) => o.id === edit.openingId);
  if (!opening) { hideDimInput(); return; }
  const value = Math.max(0, Number(el('dimInputField').value) || 0);
  const walls = deriveWalls(state.project);
  const placed = openingRect(state.project, opening, walls);
  if (!placed) { hideDimInput(); return; }
  const { wall } = placed;
  const room = roomById(state.project, opening.roomId);
  const base = wall.orient === 'h' ? room.x : room.y;
  const half = opening.width / 2;
  const desired = edit.kind === 'left'
    ? (wall.from - base) + value + half
    : (wall.to - base) - value - half;
  mutate(() => {
    const clamped = clampOpeningOffset(state.project, opening, deriveWalls(state.project), desired);
    if (clamped !== null) opening.offset = clamped;
    else toast('Сюда проём не помещается');
  });
  hideDimInput();
  selectObject({ type: 'opening', id: opening.id });
}

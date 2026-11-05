// Поле ввода размера по клику на размерную линию.

import { cloneProject, roomById } from '../core/model.js';
import { moveWallBy, wallRoomDimensions } from '../core/wall-edit.js';
import { clampOpeningOffset, deriveWalls, openingRect } from '../core/walls.js';
import { fitOpeningOffset, resolveOpeningConflicts } from '../core/opening-spacing.js';
import { el, toast } from './dom.js';
import { state } from './state.js';
import { mutate } from './store.js';
import { selectObject } from './tools.js';

// Инлайн-ввод размера (отступа до стены) прямо на размерной линии.
export function openDimInput(dim) {
  const overlay = el('dimInput');
  const input = el('dimInputField');
  state.dimEdit = dim.type === 'wall'
    ? { type: 'wall', wallKey: dim.wallKey, wallFrom: dim.wallFrom, roomId: dim.roomId }
    : { type: 'opening', openingId: state.selection.id, kind: dim.kind };
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
  if (edit.type === 'wall') {
    const value = Math.max(0, Number(el('dimInputField').value) || 0);
    const walls = deriveWalls(state.project);
    const wall = walls.find((candidate) => candidate.key === edit.wallKey &&
      (edit.wallFrom === undefined || Math.abs(candidate.from - edit.wallFrom) < 1));
    const dim = wall && wallRoomDimensions(state.project, wall).find((candidate) => candidate.roomId === edit.roomId);
    if (!wall || !dim) { hideDimInput(); return; }
    const target = dim.opposite.edge + dim.edge.outward * value;
    const delta = target - dim.edge.edge;

    // Сначала проверяем на копии, чтобы неверное число не создавало пустую
    // запись Undo и не оставляло промежуточную геометрию.
    // project.rooms/openings/items — скрытые аксессоры активного этажа.
    // Обычный structuredClone их теряет, поэтому копируем через модель.
    const probe = cloneProject(state.project);
    const probeWall = deriveWalls(probe).find((candidate) => candidate.key === edit.wallKey &&
      (edit.wallFrom === undefined || Math.abs(candidate.from - edit.wallFrom) < 1));
    const verdict = moveWallBy(probe, probeWall, delta, { finalize: true });
    if (!verdict.ok) {
      toast(verdict.reason || 'Так переместить стену нельзя');
      return;
    }

    if (verdict.clamped?.length) toast(`Проёмы прижаты к краю укороченной стены: ${verdict.clamped.length}`, true);
    mutate(() => {
      moveWallBy(state.project, wall, delta, { finalize: true });
      const nextWalls = deriveWalls(state.project);
      state.project.openings = state.project.openings.filter((opening) => {
        const clamped = clampOpeningOffset(state.project, opening, nextWalls, opening.offset);
        if (clamped === null) return false;
        opening.offset = clamped;
        return true;
      });
      // Прижатые проёмы не должны налезать друг на друга.
      const spaced = resolveOpeningConflicts(state.project, nextWalls);
      if (spaced.dropped.length) toast(`Проёмов удалено: ${spaced.dropped.length} — на укороченной стене нет места`, true);
    });
    hideDimInput();
    selectObject({ type: 'wall', key: edit.wallKey, from: edit.wallFrom });
    return;
  }
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
    const clamped = fitOpeningOffset(state.project, opening, deriveWalls(state.project), desired);
    if (clamped !== null) opening.offset = clamped;
    else toast('Сюда проём не помещается: мало места или налезает на соседний проём');
  });
  hideDimInput();
  selectObject({ type: 'opening', id: opening.id });
}

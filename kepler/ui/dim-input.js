// Поле ввода размера по клику на размерную линию.

import { cloneProject } from '../core/model.js';
import { moveWallBy, wallRoomDimensions } from '../core/wall-edit.js';
import {
  clampOpeningOffset, deriveWalls, openingPos, openingPosAt, openingRect, setOpeningPos,
} from '../core/walls.js';
import { fitOpeningOffset, resolveOpeningConflicts } from '../core/opening-spacing.js';
import { el, toast } from './dom.js';
import { state } from './state.js';
import { mutate } from './store.js';
import { selectObject } from './tools.js';
import { applyTempDim } from './temp-dims.js';
import { planToScreen, screenToPlan } from './view.js';

// Инлайн-ввод размера (отступа до стены) прямо на размерной линии.
export function openDimInput(dim) {
  const overlay = el('dimInput');
  const input = el('dimInputField');
  if (dim.type === 'item-temp') state.dimEdit = { type: 'item-temp', itemId: dim.itemId, dir: dim.dir };
  else if (dim.type === 'wall') state.dimEdit = { type: 'wall', wallKey: dim.wallKey, wallFrom: dim.wallFrom, roomId: dim.roomId };
  else state.dimEdit = { type: 'opening', openingId: state.selection.id, kind: dim.kind };
  input.value = Math.round(dim.gap);
  // Точка подписи в осях дома: поле следует за панорамой и масштабом.
  state.dimEdit.anchor = screenToPlan(dim.x, dim.y);
  overlay.style.left = `${dim.x}px`;
  overlay.style.top = `${dim.y}px`;
  overlay.hidden = false;
  // focus() — синхронно, внутри жеста пользователя: иначе на телефоне не
  // откроется клавиатура. Мышью mousedown по холсту сразу после pointerdown
  // снимает фокус — тогда возвращаем его следом.
  const focus = () => { input.focus({ preventScroll: true }); input.select(); };
  focus();
  setTimeout(() => { if (!overlay.hidden && document.activeElement !== input) focus(); }, 20);
}

// Пересчитать положение поля после панорамы, щипка или колеса.
export function positionDimInput() {
  const overlay = el('dimInput');
  const anchor = state.dimEdit?.anchor;
  if (!overlay || overlay.hidden || !anchor) return;
  const p = planToScreen(anchor.x, anchor.y);
  overlay.style.left = `${p.x}px`;
  overlay.style.top = `${p.y}px`;
}

export function hideDimInput() {
  el('dimInput').hidden = true;
  state.dimEdit = null;
}

export function applyDimInput() {
  const edit = state.dimEdit;
  if (!edit) return;
  if (edit.type === 'item-temp') {
    // Временный размер мебели: при ошибке поле остаётся открытым.
    const res = applyTempDim(edit, el('dimInputField').value);
    if (!res.ok) { toast(res.reason || 'Так переместить предмет нельзя'); return; }
    hideDimInput();
    return;
  }
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
        const clamped = clampOpeningOffset(state.project, opening, nextWalls, openingPos(opening));
        if (clamped === null) return false;
        setOpeningPos(opening, clamped);
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
  const half = opening.width / 2;
  const along = edit.kind === 'left' ? wall.from + value + half : wall.to - value - half;
  const desired = openingPosAt(state.project, opening, walls, along);
  mutate(() => {
    const clamped = fitOpeningOffset(state.project, opening, deriveWalls(state.project), desired);
    if (clamped !== null) setOpeningPos(opening, clamped);
    else toast('Сюда проём не помещается: мало места или налезает на соседний проём');
  });
  hideDimInput();
  selectObject({ type: 'opening', id: opening.id });
}

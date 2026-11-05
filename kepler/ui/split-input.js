// Деление стены: плашка у стены — от какого торца отмерять и на каком
// расстоянии. Enter вставляет две совпадающие вершины (форма не меняется),
// дальше пользователь тянет нужную половину (state.pendingRoomSplit).

import { roomById } from '../core/model.js';
import { keepOpenings } from '../core/opening-anchor.js';
import { nearestWallSplitEnd, splitRoomOutlineWall, wallSplitAt } from '../core/room-shape.js';
import { el, toast } from './dom.js';
import { findWall } from './hit.js';
import { state } from './state.js';
import { refreshDerived, snapshot } from './store.js';
import { selectObject } from './tools.js';
import { planToScreen, requestDraw } from './view.js';

const isSplittable = (wall) => Boolean(wall && wall.kind === 'own' && roomById(state.project, wall.rooms?.[0]));

function editWall() {
  const edit = state.splitEdit;
  return edit ? findWall(edit.key, edit.from) : null;
}

// Точка на оси стены (в осях дома) по координате вдоль стены.
function wallPoint(wall, along) {
  const perp = wall.orient === 'h' ? (wall.center.y1 + wall.center.y2) / 2 : (wall.center.x1 + wall.center.x2) / 2;
  return wall.orient === 'h' ? { x: along, y: perp } : { x: perp, y: along };
}

// Подписи торцов — по виду на экране: дом и вид могут быть повёрнуты, поэтому
// «левый/правый» или «верхний/нижний» определяются по экранным точкам торцов.
// Возвращает торцы в экранном порядке (сначала левый/верхний).
function screenEnds(wall) {
  const lo = Math.min(wall.from, wall.to); const hi = Math.max(wall.from, wall.to);
  const pa = wallPoint(wall, lo); const pb = wallPoint(wall, hi);
  const a = planToScreen(pa.x, pa.y); const b = planToScreen(pb.x, pb.y);
  if (Math.abs(b.x - a.x) >= Math.abs(b.y - a.y)) {
    return a.x <= b.x
      ? [{ end: 'from', label: 'левого' }, { end: 'to', label: 'правого' }]
      : [{ end: 'to', label: 'левого' }, { end: 'from', label: 'правого' }];
  }
  return a.y <= b.y
    ? [{ end: 'from', label: 'верхнего' }, { end: 'to', label: 'нижнего' }]
    : [{ end: 'to', label: 'верхнего' }, { end: 'from', label: 'нижнего' }];
}

function renderEnds(wall) {
  const box = el('splitEnds');
  box.innerHTML = screenEnds(wall).map(({ end, label }) =>
    `<button type="button" data-split-end="${end}" aria-pressed="${state.splitEdit?.end === end}">${label}</button>`).join('');
}

export function openSplitInput(wall, at) {
  if (!isSplittable(wall)) {
    toast('Разделить можно собственную наружную стену помещения', true);
    return;
  }
  const near = nearestWallSplitEnd(wall, at);
  const range = wallSplitAt(wall, near.end, near.distance);
  if (range.max < range.min) {
    toast(`Стена короче ${range.min * 2} мм — разделить нельзя`, true);
    return;
  }
  const distance = Math.round(Math.max(range.min, Math.min(range.max, near.distance)));
  state.splitEdit = { key: wall.key, from: wall.from, end: near.end, distance };
  renderEnds(wall);
  const input = el('splitInputField');
  input.value = distance;
  el('splitInput').hidden = false;
  positionSplitInput();
  requestDraw();
  setTimeout(() => { input.focus(); input.select(); }, 20);
}

export function hideSplitInput() {
  const overlay = el('splitInput');
  if (overlay) overlay.hidden = true;
  if (state.splitEdit) { state.splitEdit = null; requestDraw(); }
}

// Плашка — снаружи помещения, напротив точки деления.
export function positionSplitInput() {
  const overlay = el('splitInput');
  const edit = state.splitEdit;
  if (!overlay || overlay.hidden || !edit) return;
  const wall = editWall();
  if (!wall) { hideSplitInput(); return; }
  const lo = Math.min(wall.from, wall.to); const hi = Math.max(wall.from, wall.to);
  const r = wallSplitAt(wall, edit.end, edit.distance);
  const at = Number.isFinite(r.at) ? Math.max(lo, Math.min(hi, r.at)) : (lo + hi) / 2;
  const p = wallPoint(wall, at);
  const out = wall.orient === 'h' ? { x: p.x, y: p.y + (wall.outward || 1) * 1000 } : { x: p.x + (wall.outward || 1) * 1000, y: p.y };
  const s = planToScreen(p.x, p.y); const so = planToScreen(out.x, out.y);
  const len = Math.hypot(so.x - s.x, so.y - s.y) || 1;
  const offset = 46;
  overlay.style.left = `${s.x + ((so.x - s.x) / len) * offset}px`;
  overlay.style.top = `${s.y + ((so.y - s.y) / len) * offset}px`;
}

function setEnd(end) {
  const edit = state.splitEdit;
  const wall = editWall();
  if (!edit || !wall || edit.end === end) return;
  // Точка деления остаётся на месте — меняется только торец отсчёта.
  const length = Math.abs(wall.to - wall.from);
  const current = Number(el('splitInputField').value);
  const distance = Number.isFinite(current) ? Math.round(length - current) : edit.distance;
  state.splitEdit = { ...edit, end, distance };
  el('splitInputField').value = distance;
  renderEnds(wall);
  positionSplitInput();
  requestDraw();
}

export function applySplitInput() {
  const edit = state.splitEdit;
  const wall = editWall();
  if (!edit || !isSplittable(wall)) { hideSplitInput(); return; }
  const raw = el('splitInputField').value;
  const r = wallSplitAt(wall, edit.end, raw === '' ? NaN : Number(raw));
  if (!r.ok) {
    toast(`Расстояние от торца — от ${r.min} до ${Math.floor(r.max)} мм`, true);
    el('splitInputField').focus();
    return;
  }
  hideSplitInput();
  splitWallAt(wall, r.at);
}

// Деление не меняет форму: в точке at появляются две совпадающие вершины.
// История пишется одной записью, когда пользователь потянет половину.
export function splitWallAt(wall, along) {
  const room = roomById(state.project, wall.rooms[0]);
  const before = snapshot();
  const outline = room.outline ? structuredClone(room.outline) : null;
  const notch = room.notch ? structuredClone(room.notch) : null;
  // Вставка вершин сдвигает номера сторон контура — проёмы перепривязываем.
  if (!keepOpenings(state.project, room, () => splitRoomOutlineWall(room, wall, along)).result) {
    toast('На этом коротком участке стену разделить нельзя', true);
    return false;
  }
  state.pendingRoomSplit = { roomId: room.id, before, outline, notch, moved: false };
  refreshDerived();
  selectObject({ type: 'room', id: room.id });
  toast('Стена разделена без изменения формы — тяните любую половину за круглую точку');
  return true;
}

export function bindSplitInput() {
  const overlay = el('splitInput');
  if (!overlay) return;
  // Клик по кнопкам не забирает фокус у поля — Enter продолжает работать.
  overlay.addEventListener('mousedown', (event) => {
    if (event.target.closest('button')) event.preventDefault();
  });
  overlay.addEventListener('click', (event) => {
    const endBtn = event.target.closest('[data-split-end]');
    if (endBtn) { setEnd(endBtn.dataset.splitEnd); el('splitInputField').focus(); return; }
    const action = event.target.closest('[data-split-action]')?.dataset.splitAction;
    if (action === 'ok') applySplitInput();
    else if (action === 'cancel') hideSplitInput();
  });
  overlay.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); applySplitInput(); }
    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); hideSplitInput(); }
  });
  el('splitInputField').addEventListener('input', () => {
    const edit = state.splitEdit;
    if (!edit) return;
    const value = Number(el('splitInputField').value);
    state.splitEdit = { ...edit, distance: Number.isFinite(value) ? value : edit.distance };
    positionSplitInput();
    requestDraw();
  });
}

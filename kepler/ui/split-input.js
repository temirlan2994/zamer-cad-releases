// Деление стены: по стене идёт линия деления, пока курсор двигается вдоль неё;
// размерные линии показывают расстояния до обоих торцов. Клик режет в этой
// точке; цифры вводят точный размер от левого/верхнего торца (Enter — резать),
// Esc — отмена. Резка вставляет две совпадающие вершины (форма не меняется),
// дальше пользователь тянет нужную половину (state.pendingRoomSplit).
// state.splitEdit = { key, from, along, typed } — along в осях дома.

import { roomById } from '../core/model.js';
import { keepOpenings } from '../core/opening-anchor.js';
import { splitRoomOutlineWall, WALL_SPLIT_MIN_GAP } from '../core/room-shape.js';
import { toast } from './dom.js';
import { findWall } from './hit.js';
import { state } from './state.js';
import { refreshDerived, snapshot } from './store.js';
import { selectObject } from './tools.js';
import { planToScreen, requestDraw } from './view.js';

const STEP = 50;
const isSplittable = (wall) => Boolean(wall && wall.kind === 'own' && roomById(state.project, wall.rooms?.[0]));

function editWall() {
  const edit = state.splitEdit;
  return edit ? findWall(edit.key, edit.from) : null;
}

const span = (wall) => ({ lo: Math.min(wall.from, wall.to), hi: Math.max(wall.from, wall.to) });

function wallPoint(wall, along) {
  const perp = wall.orient === 'h' ? (wall.center.y1 + wall.center.y2) / 2 : (wall.center.x1 + wall.center.x2) / 2;
  return wall.orient === 'h' ? { x: along, y: perp } : { x: perp, y: along };
}

// Какой торец на экране «левый/верхний» (дом и вид могут быть повёрнуты).
function leadingEnd(wall) {
  const { lo, hi } = span(wall);
  const pa = wallPoint(wall, lo); const pb = wallPoint(wall, hi);
  const a = planToScreen(pa.x, pa.y); const b = planToScreen(pb.x, pb.y);
  const horizontal = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
  const loFirst = horizontal ? a.x <= b.x : a.y <= b.y;
  return loFirst ? 'lo' : 'hi';
}

// Точка на стене: от ближайшего торца кратно STEP, не ближе WALL_SPLIT_MIN_GAP.
export function snapAlong(wall, along) {
  const { lo, hi } = span(wall);
  const min = lo + WALL_SPLIT_MIN_GAP; const max = hi - WALL_SPLIT_MIN_GAP;
  const p = Math.max(lo, Math.min(hi, along));
  const snapped = p - lo <= hi - p ? lo + Math.round((p - lo) / STEP) * STEP : hi - Math.round((hi - p) / STEP) * STEP;
  return Math.max(min, Math.min(max, snapped));
}

export function openSplitInput(wall, at) {
  if (!isSplittable(wall)) {
    toast('Разделить можно собственную наружную стену помещения', true);
    return;
  }
  const { lo, hi } = span(wall);
  if (hi - lo < WALL_SPLIT_MIN_GAP * 2 + STEP) {
    toast(`Стена короче ${WALL_SPLIT_MIN_GAP * 2 + STEP} мм — разделить нельзя`, true);
    return;
  }
  state.splitEdit = { key: wall.key, from: wall.from, along: snapAlong(wall, Number.isFinite(at) ? at : (lo + hi) / 2), typed: '' };
  requestDraw();
  toast('Ведите вдоль стены и нажмите — стена разделится. Цифры — точный размер, Esc — отмена');
}

export function hideSplitInput() {
  if (state.splitEdit) { state.splitEdit = null; requestDraw(); }
}

// Размеры деления для рисования: расстояния до торцов (мм) и торец отсчёта.
export function splitDims(wall, edit) {
  const { lo, hi } = span(wall);
  return { lo, hi, at: edit.along, toLo: edit.along - lo, toHi: hi - edit.along };
}

// Курсор вдоль стены: plan — точка в осях дома.
export function splitLiveMove(plan) {
  const edit = state.splitEdit; const wall = editWall();
  if (!edit || !wall) return false;
  edit.along = snapAlong(wall, wall.orient === 'h' ? plan.x : plan.y);
  edit.typed = '';
  requestDraw();
  return true;
}

// Клик: резать в текущей точке (тач — только если нажали у линии).
export function splitLiveClick(plan, screen, coarse) {
  const edit = state.splitEdit; const wall = editWall();
  if (!edit || !wall) return false;
  if (coarse) {
    const p = wallPoint(wall, edit.along); const s = planToScreen(p.x, p.y);
    if (Math.hypot(s.x - screen.x, s.y - screen.y) > 26) { splitLiveMove(plan); return true; }
  } else {
    splitLiveMove(plan);
  }
  applySplit();
  return true;
}

// Клавиши режима. → true, если клавиша обработана.
export function splitLiveKey(event) {
  const edit = state.splitEdit;
  if (!edit) return false;
  const wall = editWall();
  if (event.key === 'Escape') { hideSplitInput(); return true; }
  if (!wall) return false;
  if (event.key === 'Enter') { applySplit(); return true; }
  if (/^[0-9]$/.test(event.key) && !event.ctrlKey && !event.metaKey) edit.typed = (edit.typed + event.key).slice(0, 6);
  else if (event.key === 'Backspace') edit.typed = edit.typed.slice(0, -1);
  else return false;
  if (edit.typed) {
    const { lo, hi } = span(wall);
    const d = Number(edit.typed);
    const raw = leadingEnd(wall) === 'lo' ? lo + d : hi - d;
    edit.along = Math.max(lo + WALL_SPLIT_MIN_GAP, Math.min(hi - WALL_SPLIT_MIN_GAP, raw));
  }
  requestDraw();
  return true;
}

export function positionSplitInput() {}
export function bindSplitInput() {}

function applySplit() {
  const edit = state.splitEdit; const wall = editWall();
  if (!edit || !isSplittable(wall)) { hideSplitInput(); return; }
  const at = edit.along;
  hideSplitInput();
  splitWallAt(wall, at);
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

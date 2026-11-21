// Правка перил открытых помещений (core/railings.js): удалить, тип, высота,
// длина, разрыв, перила на стороне. Каждая правка — один шаг отмены; перила
// по умолчанию материализуются при первой правке.

import {
  RAILING_MIN_LEN, materializeRailings, nextRailingType, railingTypeTitle, removeRailing,
  roomRailings, setRailingProps, setRailingRange, setSideRailing, sideLength, splitRailing,
} from '../core/railings.js';
import { roomById } from '../core/model.js';
import { toast } from './dom.js';
import { state } from './state.js';
import { mutate } from './store.js';
import { selectObject } from './tools.js';

// Выбранный сегмент: { room, seg } (seg — с геометрией) или null.
export function selectedRailing(sel = state.selection) {
  if (sel?.type !== 'railing') return null;
  const room = roomById(state.project, sel.roomId);
  if (!room) return null;
  const seg = roomRailings(room, state.project.rooms, state.project.settings).find((s) => s.id === sel.id);
  return seg ? { room, seg } : null;
}

function editRoom(room, fn) {
  let out;
  mutate(() => {
    materializeRailings(room, state.project.rooms, state.project.settings);
    out = fn();
  });
  return out;
}

export function deleteSelectedRailing() {
  const hit = selectedRailing();
  if (!hit) return false;
  editRoom(hit.room, () => removeRailing(hit.room, hit.seg.id));
  state.selection = null;
  selectObject(null);
  toast('Перила удалены · Ctrl+Z — вернуть');
  return true;
}

export function cycleSelectedRailingType() {
  const hit = selectedRailing();
  if (!hit) return;
  const type = nextRailingType(hit.seg.type);
  editRoom(hit.room, () => setRailingProps(hit.room, hit.seg.id, { type }));
  selectObject({ ...state.selection });
  toast(`Перила: ${railingTypeTitle(type).toLowerCase()}`);
}

export function setSelectedRailingProps(patch) {
  const hit = selectedRailing();
  if (!hit) return;
  editRoom(hit.room, () => setRailingProps(hit.room, hit.seg.id, patch));
  selectObject({ ...state.selection });
}

// Длина и положение «от начала стороны» (мм).
export function setSelectedRailingRange({ from, length }) {
  const hit = selectedRailing();
  if (!hit) return;
  const start = from ?? hit.seg.from;
  const len = Math.max(RAILING_MIN_LEN, length ?? (hit.seg.to - hit.seg.from));
  const max = sideLength(hit.room, hit.seg.side);
  const a = Math.max(0, Math.min(start, max - RAILING_MIN_LEN));
  editRoom(hit.room, () => setRailingRange(hit.room, hit.seg.id, a, Math.min(max, a + len)));
  selectObject({ ...state.selection });
}

// Разрыв: делит сегмент в точке клика (или посередине) на два, чтобы
// убрать часть; выбранной остаётся первая половина.
export function splitSelectedRailing() {
  const hit = selectedRailing();
  if (!hit) return;
  const at = state.selection.at;
  const inside = at > hit.seg.from + RAILING_MIN_LEN && at < hit.seg.to - RAILING_MIN_LEN;
  let partId = null;
  editRoom(hit.room, () => { partId = splitRailing(hit.room, hit.seg.id, inside ? at : null); });
  if (!partId) { toast('Сегмент слишком короткий, чтобы разделить', true); return; }
  selectObject({ type: 'railing', roomId: hit.room.id, id: hit.seg.id });
  toast('Перила разделены на два сегмента — лишний можно удалить');
}

// «Перила на этой стороне» для открытой комнаты.
export function setRoomSideRailing(roomId, side, on) {
  const room = roomById(state.project, roomId);
  if (!room) return;
  mutate(() => { setSideRailing(room, state.project.rooms, state.project.settings, side, on); });
}

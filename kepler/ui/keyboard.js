// Клавиатура: горячие клавиши, пробел для панорамы.

import { roomById } from '../core/model.js';
import { moveRoomBy, validateRoomPlacement } from '../core/rooms.js';
import { canvas, toast } from './dom.js';
import { stepLevel } from './levels.js';
import {
  deleteSelection, reconcileOpenings, rotateMulti90, rotateSelectedItem,
} from './plan-actions.js';
import { finishDraft } from './site-actions.js';
import { state } from './state.js';
import {
  afterChange, mutate, pushHistory, redo, refreshDerived, restoreFrom, snapshot, undo,
} from './store.js';
import { cancelTool, selectObject } from './tools.js';

export let spaceDown = false;

export function bindKeyboard() {
  window.addEventListener('keydown', (event) => {
    if (event.code === 'Space') {
      const tag = event.target.tagName;
      if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
        spaceDown = true;
        canvas.style.cursor = 'grab';
        event.preventDefault();
      }
      return;
    }
    const tag = event.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if ((event.ctrlKey || event.metaKey) && event.code === 'KeyZ') {
      event.preventDefault();
      if (event.shiftKey) redo(); else undo();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.code === 'KeyY') { event.preventDefault(); redo(); return; }
    if (event.key === 'PageUp' || event.key === 'PageDown') {
      event.preventDefault();
      stepLevel(event.key === 'PageUp' ? 1 : -1);
      return;
    }
    if (event.key === 'Enter' && state.draft) { finishDraft(); return; }
    if (event.key === 'Escape') { cancelTool(); selectObject(null); return; }
    if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); deleteSelection(); return; }
    if (event.code === 'KeyR') {
      if (state.selection?.type === 'multi') rotateMulti90(); else rotateSelectedItem();
      return;
    }
    const nudge = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (nudge && state.selection) {
      event.preventDefault();
      const step = (event.shiftKey ? 500 : 50);
      const [dx, dy] = [nudge[0] * step, nudge[1] * step];
      if (state.selection.type === 'room') {
        const room = roomById(state.project, state.selection.id);
        if (!room) return;
        const before = snapshot();
        moveRoomBy(state.project, room.id, dx, dy);
        const verdict = validateRoomPlacement(state.project, room, room.id);
        if (!verdict.ok) { restoreFrom(before); toast(verdict.reason); return; }
        reconcileOpenings();
        refreshDerived();
        pushHistory(before);
        afterChange();
      } else if (state.selection.type === 'item') {
        const item = state.project.items.find((i) => i.id === state.selection.id);
        if (!item) return;
        mutate(() => { item.x += dx; item.y += dy; });
      }
    }
  });
  window.addEventListener('keyup', (event) => {
    if (event.code === 'Space') { spaceDown = false; canvas.style.cursor = 'crosshair'; }
  });
}

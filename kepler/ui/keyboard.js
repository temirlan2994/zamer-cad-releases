// Клавиатура: горячие клавиши, пробел для панорамы.

import { GRID_STEP } from '../core/catalog.js';
import { roomById } from '../core/model.js';
import { moveRoomBy, validateRoomPlacement } from '../core/rooms.js';
import { moveBuilding } from '../core/site-check.js';
import { canvas, toast } from './dom.js';
import { closeHelp, isHelpOpen, openHelp } from './help.js';
import { closeProjects, isProjectsOpen } from './projects.js';
import { hideSofaMenu } from './props-composite.js';
import { stepLevel } from './levels.js';
import {
  copySelection, deleteSelection, duplicateSelection, mirrorSelection, moveMultiBy, pasteSelection,
  reconcileOpenings, rotateSelection90,
} from './plan-actions.js';
import { finishDraft } from './site-actions.js';
import { state } from './state.js';
import {
  afterChange, mutate, pushHistory, redo, refreshDerived, restoreFrom, snapshot, undo,
} from './store.js';
import { cancelTool, rotatePlacementPreview, selectObject } from './tools.js';
import { closeCompare, isCompareOpen } from './variants.js';
import { close3d, is3dOpen } from './view3d.js';

export let spaceDown = false;

export function bindKeyboard() {
  window.addEventListener('keydown', (event) => {
    // 3D и справка закрываются по Esc откуда угодно (и с флажков 3D).
    if (event.key === 'Escape' && isHelpOpen()) { closeHelp(); return; }
    if (event.key === 'Escape' && isProjectsOpen()) { closeProjects(); return; }
    if (event.key === 'Escape' && isCompareOpen()) { closeCompare(); return; }
    if (event.key === 'Escape' && is3dOpen()) { close3d(); return; }
    if (event.key === 'Escape' && state.sofaMenu) { hideSofaMenu(); return; }
    if (event.code === 'Space') {
      const tag = event.target.tagName;
      if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
        if (!event.repeat && rotatePlacementPreview()) {
          event.preventDefault();
          return;
        }
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
    if ((event.ctrlKey || event.metaKey) && event.code === 'KeyC' && state.selection) {
      event.preventDefault();
      copySelection();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.code === 'KeyV') {
      event.preventDefault();
      pasteSelection();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.code === 'KeyD' && state.selection) {
      event.preventDefault();
      duplicateSelection();
      return;
    }
    if (event.key === '?' || event.key === 'F1') {
      event.preventDefault();
      if (isHelpOpen()) closeHelp(); else openHelp();
      return;
    }
    if (event.key === 'PageUp' || event.key === 'PageDown') {
      event.preventDefault();
      stepLevel(event.key === 'PageUp' ? 1 : -1);
      return;
    }
    if (event.key === 'Enter' && state.draft) { finishDraft(); return; }
    if (event.key === 'Escape') { cancelTool(); selectObject(null); return; }
    if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); deleteSelection(); return; }
    if (event.code === 'KeyR') {
      rotateSelection90();
      return;
    }
    if (event.code === 'KeyM' && state.selection) {
      mirrorSelection();
      return;
    }
    const nudge = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (nudge && state.selection) {
      event.preventDefault();
      const step = event.shiftKey ? GRID_STEP * 10 : GRID_STEP;
      const [dx, dy] = [nudge[0] * step, nudge[1] * step];
      if (state.selection.type === 'site' && state.selection.kind === 'building') {
        // Дом целиком по участку (в координатах съёмки): одна запись истории.
        mutate(() => { state.project.building = moveBuilding(state.project.building, dx, dy); });
      } else if (state.selection.type === 'room') {
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
      } else if (state.selection.type === 'multi') {
        // Группа: помещения с мебелью, лестницами и проёмами — одной записью истории.
        moveMultiBy(dx, dy);
      }
    }
  });
  window.addEventListener('keyup', (event) => {
    if (event.code === 'Space') { spaceDown = false; canvas.style.cursor = 'crosshair'; }
  });
}

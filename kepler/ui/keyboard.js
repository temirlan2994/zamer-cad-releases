// Клавиатура: горячие клавиши, пробел для панорамы.

import { gridStep } from './snap.js';
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
import {
  addLandscapeDraftExact, handleLandscapeKey, landscapeDraftPrev, rotateLandscapeGhost,
} from './landscape.js';
import { addDraftPoint, finishDraft } from './site-actions.js';
import { closeSection, isSectionOpen } from './landscape-section.js';
import { handleDynamicKey, rehoverSnap, toggleOrtho } from './draw-snap-ui.js';
import { state } from './state.js';
import {
  afterChange, mutate, pushHistory, redo, refreshDerived, restoreFrom, snapshot, undo,
} from './store.js';
import { cancelTool, rotatePlacementPreview, selectObject } from './tools.js';
import { closeCompare, isCompareOpen } from './variants.js';
import { close3d, is3dOpen } from './view3d.js';
import { requestDraw } from './view.js';

export let spaceDown = false;

// Поверх плана открыто окно (3D, справка, «Проекты», сравнение, разрез,
// стартовое меню) — план под ним клавишами не правится.
export function planCovered() {
  return is3dOpen() || isSectionOpen() || Boolean(document.querySelector('.start-screen:not([hidden])'));
}

// Элемент, которому Enter/Space нужны самому (кнопка, ссылка, флажок…).
function ownsActivationKeys(target) {
  if (!target || target === document.body || !target.tagName) return false;
  const tag = target.tagName;
  if (tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY' || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  const role = target.getAttribute?.('role');
  return role === 'button' || role === 'menuitem' || role === 'tab' || role === 'checkbox' || role === 'switch' || role === 'option';
}

export function bindKeyboard() {
  // Кнопка, нажатая мышью или пальцем, не держит фокус: иначе следующий
  // Enter «нажмёт» её ещё раз вместо завершения чертежа. Нажатая с клавиатуры
  // (detail === 0) фокус сохраняет.
  document.addEventListener('click', (event) => {
    const btn = event.target?.closest?.('button, [role="button"]');
    if (btn && event.detail > 0 && document.activeElement === btn) btn.blur();
  });
  window.addEventListener('keydown', (event) => {
    // 3D и справка закрываются по Esc откуда угодно (и с флажков 3D).
    if (event.key === 'Escape' && isHelpOpen()) { closeHelp(); return; }
    if (event.key === 'Escape' && isProjectsOpen()) { closeProjects(); return; }
    if (event.key === 'Escape' && isCompareOpen()) { closeCompare(); return; }
    if (event.key === 'Escape' && is3dOpen()) { close3d(); return; }
    if (event.key === 'Escape' && state.sofaMenu) { hideSofaMenu(); return; }
    // Окно разреза: Esc закрывает, правка плана под ним не идёт (кроме Ctrl+Z/Y).
    if (isSectionOpen()) {
      if (event.key === 'Escape') { closeSection(); return; }
      if (!((event.ctrlKey || event.metaKey) && (event.code === 'KeyZ' || event.code === 'KeyY'))) return;
    }
    // Под 3D, справкой, «Проектами», сравнением — только Ctrl+Z/Y и F1/«?».
    if (planCovered()) {
      const undoKey = (event.ctrlKey || event.metaKey) && (event.code === 'KeyZ' || event.code === 'KeyY');
      const helpKey = (event.key === '?' || event.key === 'F1') && isHelpOpen();
      if (!undoKey && !helpKey) return;
    }
    // Enter и Space на кнопке в фокусе — её собственные (нажать кнопку).
    if ((event.key === 'Enter' || event.code === 'Space') && ownsActivationKeys(event.target)) return;
    if (event.code === 'Space') {
      const tag = event.target.tagName;
      if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
        if (!event.repeat && (rotatePlacementPreview() || rotateLandscapeGhost())) {
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
    // Привязки черчения: F8 — орто; Shift/Ctrl — пересчитать привязку на месте.
    if (event.key === 'F8') { event.preventDefault(); toggleOrtho(); return; }
    if ((event.key === 'Shift' || event.key === 'Control') && !event.repeat) {
      rehoverSnap({ shiftKey: event.shiftKey, ctrlKey: event.ctrlKey });
    }
    // Динамический ввод: число (+ Tab — угол) и Enter — следующая точка.
    const dynPrev = state.draft?.points?.length ? state.draft.points[state.draft.points.length - 1] : landscapeDraftPrev();
    if (handleDynamicKey(event, dynPrev, (p) => {
      if (state.draft) addDraftPoint(p, null, { exact: true }); else addLandscapeDraftExact(p);
    })) return;
    if ((event.ctrlKey || event.metaKey) && event.code === 'KeyZ') {
      event.preventDefault();
      if (event.shiftKey) redo(); else undo();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.code === 'KeyY') { event.preventDefault(); redo(); return; }
    // «Ландшафт»: копирование, удаление, поворот, стрелки — свои объекты.
    if (state.modeName === 'landscape' && handleLandscapeKey(event)) return;
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
    if (event.key === 'Escape') {
      // Сначала Esc выходит из режима ручек мебели (поворот, растяжение, масштаб) —
      // предмет остаётся выбранным; следующий Esc снимает выбор.
      if (!state.tool && state.selection?.type === 'item' && state.itemHandle && state.itemHandle.mode !== 'select') {
        state.itemHandle = null;
        requestDraw();
        return;
      }
      cancelTool(); selectObject(null); return;
    }
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
      const step = event.shiftKey ? gridStep() * 10 : gridStep();
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
    if (event.key === 'Shift' || event.key === 'Control') rehoverSnap({ shiftKey: event.shiftKey, ctrlKey: event.ctrlKey });
  });
}

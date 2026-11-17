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
import { applyLibraryTab } from './library.js';
import {
  copySelection, deleteSelection, duplicateSelection, eatOverlapsAfter, mirrorSelection, moveMultiBy,
  pasteSelection, reconcileOpenings, rotateSelection90,
} from './plan-actions.js';
import {
  addLandscapeDraftExact, handleLandscapeKey, landscapeDraftPrev, rotateLandscapeGhost,
} from './landscape.js';
import { addDraftPoint, finishDraft } from './site-actions.js';
import { closeSection, isSectionOpen } from './landscape-section.js';
import { closeSheet, handleSheetKey, isSheetOpen, returnToSheet } from './sheet-view.js';
import { closeElevation, isElevationOpen } from './elevation-view.js';
import { handleDynamicKey, rehoverSnap, toggleOrtho } from './draw-snap-ui.js';
import { splitLiveKey } from './split-input.js';
import { state } from './state.js';
import { handleErgoKey } from './ergonomics.js';
import {
  afterChange, mutate, pushHistory, redo, refreshDerived, reflowLayoutChanges, restoreFrom, snapshot, undo,
} from './store.js';
import { cancelTool, rotatePlacementPreview, selectObject } from './tools.js';
import { finishWallChain, startWallTool } from './wall-tool.js';
import { handlePlanSectionKey, startPlanSectionTool } from './plan-section.js';
import { close3d, escape3d, is3dOpen } from './view3d.js';
import { requestDraw } from './view.js';
import { isItemGroup } from '../core/group-handles.js';
import { massToolBack as planMassBack, startMassTool, toggleMassTool } from './masses.js';
import { massKey } from './mass3d.js';
import { handleGridKey } from './grids.js';
import { isRoofTool, toggleRoofTool } from './roofs.js';
import { roofPolyKey } from './roof-plan.js';
import { slabToolKey, startSlabOpeningTool } from './slab-ui.js';

export let spaceDown = false;

// Поверх плана открыто окно (3D, справка, «Проекты», разрез,
// стартовое меню) — план под ним клавишами не правится.
export function planCovered() {
  return is3dOpen() || isSectionOpen() || isSheetOpen() || isElevationOpen() ||
    Boolean(document.querySelector('.start-screen:not([hidden]), #solarReportDialog:not([hidden])'));
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

// Клавиши правки в открытом 3D (те же действия, что на плане): Delete,
// Ctrl+C/V/D, R — поворот выбранного предмета. true — клавиша обработана.
function handle3dKey(event) {
  const tag = event.target?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return false;
  const mod = event.ctrlKey || event.metaKey;
  if (!mod && !event.altKey && event.code === 'Space' && state.tool?.kind === 'place-opening') {
    event.preventDefault();
    rotatePlacementPreview();
    document.dispatchEvent(new CustomEvent('kepler:opening-tool'));
    return true;
  }
  // Инструмент «Масса»: цифры и Enter — точный размер (ui/mass3d.js); M — вкл/выкл.
  if (massKey(event)) return true;
  if (!mod && !event.altKey && event.code === 'KeyM' && state.modeName === 'plan') { toggleMassTool(event.shiftKey); return true; }
  if (!mod && !event.altKey && !event.shiftKey && event.code === 'KeyK' && state.modeName === 'plan') { toggleRoofTool(); return true; }
  if (!mod && (event.key === 'Delete' || event.key === 'Backspace')) {
    event.preventDefault();
    if (state.selection) deleteSelection();
    return true;
  }
  if (mod && event.code === 'KeyC') { event.preventDefault(); if (state.selection) copySelection(); return true; }
  if (mod && event.code === 'KeyV') { event.preventDefault(); pasteSelection(); return true; }
  if (mod && event.code === 'KeyD') { event.preventDefault(); if (state.selection) duplicateSelection(); return true; }
  if (!mod && !event.altKey && event.code === 'KeyR' && (state.selection?.type === 'item' || state.selection?.type === 'mass')) { rotateSelection90(); return true; }
  return false;
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
    if (state.editLocked && !event.target?.closest?.('#editLockScreen')) return;
    // Модальный световой отчёт — снимок проекта. Пока он открыт, даже
    // Ctrl+Z/Y не должны менять модель под уже рассчитанной таблицей.
    if (document.querySelector('#solarReportDialog:not([hidden])')) return;
    if (state.splitEdit && !/^(INPUT|TEXTAREA|SELECT)$/.test(event.target?.tagName || '') && splitLiveKey(event)) { event.preventDefault(); return; }
    // 3D и справка закрываются по Esc откуда угодно (и с флажков 3D).
    if (event.key === 'Escape' && isHelpOpen()) { closeHelp(); return; }
    if (event.key === 'Escape' && isProjectsOpen()) { closeProjects(); return; }
    // Пока окно проектов открыто (в том числе во время облачной записи или
    // удаления), никакие команды плана — даже Ctrl+Z/Y — не проходят вниз.
    if (isProjectsOpen()) return;
    // Вид открыт двойным кликом на листе — Esc закрывает его и возвращает лист.
    // В 3D Esc сначала отменяет жест и снимает выбор, без выбора — закрывает вид.
    if (event.key === 'Escape' && is3dOpen()) {
      if (escape3d()) return;
      const back = state.sheetReturn; close3d(); if (back) returnToSheet(); return;
    }
    // Открытый лист (ui/sheet-view.js): Esc возвращает предыдущий вид.
    // Лист пользователя: Delete убирает выбранный вид, Esc снимает выбор.
    if (isSheetOpen() && handleSheetKey(event)) return;
    if (event.key === 'Escape' && isSheetOpen()) { closeSheet({ restoreView: true }); return; }
    // Открытый фасад (ui/elevation-view.js): Esc — «Закрыть вид».
    if (event.key === 'Escape' && isElevationOpen()) { const back = state.sheetReturn; closeElevation(); if (back) returnToSheet(); return; }
    if (event.key === 'Escape' && state.sofaMenu) { hideSofaMenu(); return; }
    // Окно разреза: Esc закрывает, правка плана под ним не идёт (кроме Ctrl+Z/Y).
    if (isSectionOpen()) {
      if (event.key === 'Escape') { closeSection(); return; }
      if (!((event.ctrlKey || event.metaKey) && (event.code === 'KeyZ' || event.code === 'KeyY'))) return;
    }
    // 3D: выбранное удаляется, копируется, дублируется, мебель поворачивается.
    if (is3dOpen() && !isHelpOpen() && handle3dKey(event)) return;
    // Под 3D, справкой, «Проектами» — только Ctrl+Z/Y и F1/«?».
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
    // Координационные оси: G — инструмент, Tab — направление, стрелки — сдвиг (ui/grids.js).
    if (!planCovered() && handleGridKey(event)) { event.preventDefault(); return; }
    // K — инструмент «Крыша» (ui/roofs.js).
    if (!planCovered() && event.code === 'KeyK' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey &&
      state.modeName === 'plan' && (!state.tool || isRoofTool())) {
      event.preventDefault();
      toggleRoofTool();
      import('./toolstrip.js').then((m) => m.renderToolstrip());
      return;
    }
    // E — режим «Эргономика» (ui/ergonomics.js).
    if (!planCovered() && handleErgoKey(event)) { event.preventDefault(); return; }
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
    // Контур крыши по точкам: Enter — замкнуть, Backspace — точка назад, Esc — бросить (ui/roof-plan.js).
    if (roofPolyKey(event)) { event.preventDefault(); return; }
    if (slabToolKey(event)) { event.preventDefault(); return; }
    if (event.key === 'Enter' && state.draft) { finishDraft(); return; }
    // Инструмент «Стена»: Enter и Esc заканчивают цепочку (стены остаются).
    if ((event.key === 'Enter' || event.key === 'Escape') && state.tool?.kind === 'wall') { finishWallChain(); return; }
    if (handlePlanSectionKey(event)) { event.preventDefault(); return; }
    if (event.code === 'KeyS' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && state.modeName === 'plan' && !state.tool) {
      startPlanSectionTool();
      return;
    }
    // M без выбора — инструмент «Масса», Shift+M — вычитающая масса.
    if (event.code === 'KeyM' && !event.ctrlKey && !event.metaKey && !event.altKey && state.modeName === 'plan' && !state.tool && !state.selection) {
      startMassTool(event.shiftKey);
      return;
    }
    if (event.key === 'Escape' && state.tool?.kind === 'mass') { planMassBack(); return; }
    if (event.code === 'KeyW' && !event.ctrlKey && !event.metaKey && !event.altKey && state.modeName === 'plan' && !state.tool) {
      startWallTool();
      return;
    }
    if (event.code === 'KeyO' && !event.ctrlKey && !event.metaKey && !event.altKey && state.modeName === 'plan' && !state.tool) {
      startSlabOpeningTool();
      import('./toolstrip.js').then((m) => m.renderToolstrip());
      return;
    }
    if (event.key === 'Escape') {
      // Сначала Esc выходит из режима ручек мебели (поворот, растяжение, масштаб) —
      // предмет остаётся выбранным; следующий Esc снимает выбор.
      const ownsHandle = state.selection?.type === 'item' || state.selection?.type === 'landscape' || isItemGroup(state.selection);
      if (!state.tool && ownsHandle && state.itemHandle && state.itemHandle.mode !== 'select') {
        state.itemHandle = null;
        requestDraw();
        return;
      }
      if (!state.tool && state.libraryPinned) { state.libraryPinned = false; applyLibraryTab(); } // Esc закрывает библиотеку
      // План открыт двойным кликом на листе: Esc без инструмента и выбора — назад к листу.
      if (!state.tool && !state.selection && state.sheetReturn && returnToSheet()) return;
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
        if (!room.parentId) eatOverlapsAfter([room.id]);
        reconcileOpenings();
        refreshDerived();
        reflowLayoutChanges(before);
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

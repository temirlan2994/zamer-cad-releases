// Быстрый тап выбирает предмет штатным обработчиком карточки. После
// удержания палец переносит его на свободную часть плана, обычный свайп листает каталог.
import { GRID_STEP } from '../core/catalog.js';
import { canvas } from './dom.js';
import { closeLibrarySheet, isPhone } from './mobile.js';
import { addFurnitureAt, furnitureForPlacement } from './plan-actions.js';
import { state } from './state.js';
import { cancelTool } from './tools.js';
import { requestDraw, screenToPlan } from './view.js';

export function bindFurnitureTouch(items) {
  const sheet = items.closest('.library');
  let drag = null;
  let timer;

  function clearGhost() {
    if (drag?.preview && state.ghostItem === drag.preview) {
      state.ghostItem = null;
      requestDraw();
    }
  }

  function reset() {
    clearTimeout(timer);
    if (!drag) return;
    clearGhost();
    drag.card.draggable = drag.draggable;
    drag.card.classList.remove('dragging');
    sheet.classList.remove('furniture-dragging');
    drag = null;
  }

  function planPoint(touch) {
    if (drag.project !== state.project || drag.level !== state.project.activeLevel
        || !document.body.classList.contains('sheet-library') || state.modeName !== 'plan'
        || document.elementFromPoint(touch.clientX, touch.clientY) !== canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return screenToPlan(touch.clientX - rect.left, touch.clientY - rect.top);
  }

  items.addEventListener('touchstart', (event) => {
    const card = event.target.closest('.furniture-chip[data-kind]');
    if (event.touches.length !== 1 || !card || !isPhone()) return;
    reset();
    const touch = event.touches[0];
    drag = { card, kind: card.dataset.kind, x: touch.clientX, y: touch.clientY,
      project: state.project, level: state.project.activeLevel, draggable: card.draggable };
    card.draggable = false;
    timer = setTimeout(() => {
      if (!card.isConnected || !document.body.classList.contains('sheet-library')) { reset(); return; }
      drag.preview = furnitureForPlacement(drag.kind, 0, 0);
      if (!drag.preview) { reset(); return; }
      card.classList.add('dragging');
      sheet.classList.add('furniture-dragging');
    }, 300);
  }, { passive: true });
  document.addEventListener('touchstart', (event) => {
    if (drag && event.touches.length > 1) reset();
  }, { passive: true, capture: true });

  items.addEventListener('touchmove', (event) => {
    if (!drag) return;
    const touch = event.touches[0];
    const moved = Math.hypot(touch.clientX - drag.x, touch.clientY - drag.y) > 8;
    if (!drag.preview) { if (moved) reset(); return; }
    event.preventDefault();
    if (!moved) { clearGhost(); return; }
    const p = planPoint(touch);
    if (!p) { clearGhost(); return; }
    drag.preview.x = Math.round(p.x / GRID_STEP) * GRID_STEP;
    drag.preview.y = Math.round(p.y / GRID_STEP) * GRID_STEP;
    state.ghostItem = drag.preview;
    requestDraw();
  }, { passive: false });

  items.addEventListener('touchend', (event) => {
    if (!drag?.preview) { reset(); return; }
    event.preventDefault(); // браузер не создаст второй клик после переноса
    const touch = event.changedTouches[0];
    const at = Math.hypot(touch.clientX - drag.x, touch.clientY - drag.y) > 8 && planPoint(touch);
    const kind = drag.kind;
    reset();
    if (!at) return;
    cancelTool();
    closeLibrarySheet();
    addFurnitureAt(kind, at.x, at.y);
  }, { passive: false });
  items.addEventListener('touchcancel', reset);
  items.addEventListener('pointercancel', reset);
  items.addEventListener('contextmenu', (event) => { if (drag) event.preventDefault(); });
  window.addEventListener('blur', reset);
}

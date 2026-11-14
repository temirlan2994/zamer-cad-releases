// Эфемерный предпросмотр авторасстановки. Он живёт только в UI-state,
// никогда не сериализуется и не создаёт запись Undo/Redo.

import { state } from './state.js';
import { requestDraw } from './view.js';

export const LAYOUT_PREVIEW_EVENT = 'kepler:layout-preview-change';

function notify(previous) {
  if (globalThis.document && typeof globalThis.CustomEvent === 'function') {
    document.dispatchEvent(new CustomEvent(LAYOUT_PREVIEW_EVENT, {
      detail: { preview: state.layoutPreview, previous: previous || null },
    }));
  }
}

export function setLayoutPreview(preview) {
  const previous = state.layoutPreview;
  state.layoutPreview = preview || null;
  notify(previous);
  requestDraw();
  return state.layoutPreview;
}

export function clearLayoutPreview(roomIds = null, { redraw = true } = {}) {
  const current = state.layoutPreview;
  if (!current) return false;
  if (roomIds != null) {
    const wanted = roomIds instanceof Set
      ? roomIds
      : new Set(Array.isArray(roomIds) ? roomIds : [roomIds]);
    if (!wanted.has(current.roomId)) return false;
  }
  state.layoutPreview = null;
  notify(current);
  if (redraw) requestDraw();
  return true;
}

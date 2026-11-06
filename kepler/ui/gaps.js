// Нестандартные зазоры на плане: выбор пары по маркеру «≠ N мм» (маркеры
// рисует render.js, их экранные рамки — state._gapBoxes). Список зазоров и
// кнопка «Пристыковать» — в панели замечаний (ui/issues.js), сдвиг —
// dockGapPair (ui/plan-actions.js).

import { renderIssues } from './issues.js';
import { state } from './state.js';
import { selectObject } from './tools.js';
import { requestDraw } from './view.js';

// Пара, выбранная по маркеру/строке и всё ещё выделенная.
export function focusedGap() {
  const gap = (state.gaps || []).find((g) => g.key === state.gapFocus);
  const sel = state.selection;
  if (!gap || sel?.type !== 'multi') return null;
  return sel.roomIds.includes(gap.a) && sel.roomIds.includes(gap.b) ? gap : null;
}

export function gapMarkerAt(sx, sy) {
  const box = (state._gapBoxes || []).find((b) => sx >= b.x && sx <= b.x + b.w && sy >= b.y && sy <= b.y + b.h);
  return box ? box.key : null;
}

export function focusGap(key) {
  const gap = (state.gaps || []).find((g) => g.key === key);
  if (!gap) return;
  state.gapFocus = key;
  selectObject({ type: 'multi', roomIds: [gap.a, gap.b], itemIds: [] });
  renderIssues();
  requestDraw();
}

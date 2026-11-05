// Нестандартные зазоры на плане: плашка под полосой связности и выбор пары
// по маркеру «≠ N мм» (маркеры рисует render.js, их экранные рамки —
// state._gapBoxes). Сдвиг выполняет dockGapPair (ui/plan-actions.js).

import { planGapMove } from '../core/gaps.js';
import { el } from './dom.js';
import { dockGapPair } from './plan-actions.js';
import { state } from './state.js';
import { selectObject } from './tools.js';
import { requestDraw } from './view.js';

const mm = (v) => `${Math.round(v)} мм`;

export function gapText(gap) {
  return `Нестандартный зазор ${mm(gap.gap)} между «${gap.aName}» и «${gap.bName}» — стыковка не сработала`;
}

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
  renderGapBar();
  requestDraw();
}

// Плашка «≠ зазор»: без выбора — первая (или следующая) пара; с выбором —
// кнопка «Пристыковать» или причина, почему сдвинуть нельзя.
export function renderGapBar() {
  const bar = el('gapBar');
  if (!bar) return;
  const gaps = state.gaps || [];
  if (!gaps.length || state.modeName === 'site') { bar.hidden = true; bar.replaceChildren(); return; }
  bar.hidden = false;
  const focused = focusedGap();
  const shown = focused || gaps[0];
  const index = gaps.indexOf(shown);
  const label = document.createElement('span');
  label.className = 'gap-text';
  label.textContent = `≠ ${gapText(shown)}${gaps.length > 1 ? ` (${index + 1}/${gaps.length})` : ''}`;
  label.title = gaps.map(gapText).join('\n');
  label.addEventListener('click', () => {
    // Повторный клик по выбранной паре — к следующей.
    const next = focused ? gaps[(index + 1) % gaps.length] : shown;
    focusGap(next.key);
  });
  const parts = [label];
  if (focused) {
    const plan = planGapMove(state.project, focused);
    if (plan.move) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.action = 'dock-gap';
      btn.textContent = `Пристыковать (сдвинуть «${plan.move.name}» на ${mm(plan.move.distance)})`;
      btn.addEventListener('click', (event) => {
        event.stopPropagation();
        dockGapPair(focused);
      });
      parts.push(btn);
    } else {
      const why = document.createElement('span');
      why.className = 'gap-why';
      why.textContent = `Пристыковать сдвигом нельзя: ${plan.reason}. Поправьте положение вручную.`;
      parts.push(why);
    }
  }
  bar.replaceChildren(...parts);
}

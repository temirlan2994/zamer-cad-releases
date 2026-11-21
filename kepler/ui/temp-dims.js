// Временные размеры выбранной мебели: попадание по подписи и применение
// введённого расстояния. Геометрия — core/temp-dims.js, рисование — render.js
// (рамки подписей в state._tempDimsUI), поле ввода — ui/dim-input.js.

import { planTempDimMove } from '../core/temp-dims.js';
import { state } from './state.js';
import { mutate } from './store.js';

// Подпись временного размера под точкой экрана → { type: 'item-temp', dir, gap, x, y } или null.
export function hitTempDim(screen) {
  const ui = state._tempDimsUI;
  if (!ui || state.selection?.type !== 'item' || state.selection.id !== ui.itemId) return null;
  let best = null;
  let bestD = Infinity;
  for (const d of ui.dims) {
    const b = d.box;
    if (screen.x < b.x || screen.x > b.x + b.w || screen.y < b.y || screen.y > b.y + b.h) continue;
    const dist = Math.hypot(d.x - screen.x, d.y - screen.y);
    if (dist < bestD) { best = d; bestD = dist; }
  }
  return best && { type: 'item-temp', itemId: ui.itemId, dir: best.dir, gap: best.value, x: best.x, y: best.y };
}

// Сдвинуть предмет вдоль оси размера так, чтобы расстояние стало raw (мм).
// Один шаг Undo. → { ok, reason? }; при ошибке ничего не меняется.
export function applyTempDim(edit, raw) {
  const item = state.project.items.find((i) => i.id === edit.itemId);
  if (!item) return { ok: true };
  if (String(raw).trim() === '') return { ok: false, reason: 'Введите расстояние в мм' };
  const plan = planTempDimMove(state.project, item, edit.dir, Number(raw));
  if (!plan.ok) return plan;
  const x = Math.round(plan.x * 10) / 10;
  const y = Math.round(plan.y * 10) / 10;
  if (Math.abs(x - item.x) < 0.05 && Math.abs(y - item.y) < 0.05) return { ok: true };
  mutate(() => { item.x = x; item.y = y; });
  return { ok: true };
}

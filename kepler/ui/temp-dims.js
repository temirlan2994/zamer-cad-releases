// Временные размеры выбранной мебели: попадание по подписи и применение
// введённого расстояния. Геометрия — core/temp-dims.js, рисование — render.js
// (рамки подписей в state._tempDimsUI), поле ввода — ui/dim-input.js.

import { planTempDimMove } from '../core/temp-dims.js';
import { groupBounds, groupCenter, isItemGroup } from '../core/group-handles.js';
import { state } from './state.js';
import { mutate } from './store.js';

// Подпись временного размера под точкой экрана → { type: 'item-temp', dir, gap, x, y } или null.
export function hitTempDim(screen) {
  const ui = state._tempDimsUI;
  if (!ui) return null;
  const selection = state.selection;
  const matches = ui.itemIds
    ? isItemGroup(selection) && selection.itemIds.length === ui.itemIds.length && selection.itemIds.every((id) => ui.itemIds.includes(id))
    : selection?.type === 'item' && selection.id === ui.itemId;
  if (!matches) return null;
  let best = null;
  let bestD = Infinity;
  for (const d of ui.dims) {
    const b = d.box;
    if (screen.x < b.x || screen.x > b.x + b.w || screen.y < b.y || screen.y > b.y + b.h) continue;
    const dist = Math.hypot(d.x - screen.x, d.y - screen.y);
    if (dist < bestD) { best = d; bestD = dist; }
  }
  return best && {
    type: 'item-temp', ...(ui.itemIds ? { itemIds: [...ui.itemIds] } : { itemId: ui.itemId }),
    dir: best.dir, gap: best.value, x: best.x, y: best.y,
  };
}

// Сдвинуть предмет или всю группу вдоль оси размера до расстояния raw (мм).
// Один шаг Undo. → { ok, reason? }; при ошибке ничего не меняется.
export function applyTempDim(edit, raw) {
  const ids = edit.itemIds || [edit.itemId];
  const items = ids.map((id) => state.project.items.find((i) => i.id === id)).filter(Boolean);
  if (!items.length) return { ok: true };
  if (items.length !== ids.length) return { ok: false, reason: 'Состав группы изменился. Выберите предметы заново' };
  if (String(raw).trim() === '') return { ok: false, reason: 'Введите расстояние в мм' };
  const item = edit.itemIds ? items : items[0];
  const center = edit.itemIds ? groupCenter(groupBounds(items)) : items[0];
  const plan = planTempDimMove(state.project, item, edit.dir, Number(raw));
  if (!plan.ok) return plan;
  const x = Math.round(plan.x * 10) / 10;
  const y = Math.round(plan.y * 10) / 10;
  const dx = x - center.x; const dy = y - center.y;
  if (Math.abs(dx) < 0.05 && Math.abs(dy) < 0.05) return { ok: true };
  mutate(() => { for (const member of items) { member.x += dx; member.y += dy; } });
  return { ok: true };
}

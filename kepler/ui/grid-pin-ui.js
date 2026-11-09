// Привязка стен к координационным осям в редакторе (core/grid-pins.js):
// клик по замку на плане (ui/grid-locks.js), кнопка «Прикрепить к оси» в
// плашке выделения и блок в «Свойствах» стены, подсказка замка, запоминание
// привязки при магните (настройка «Привязка при магните»).

import {
  nearestWallGrid, pinWallToGrid, unpinWallFromGrid, wallBody, wallPins,
} from '../core/grid-pins.js';
import { escapeHtml, toast } from './dom.js';
import { lockTitle } from './grid-locks.js';
import { activeGrids, planGridPref } from './plan-grids.js';
import { state } from './state.js';
import { mutate, refreshDerived } from './store.js';

const gridById = (id) => (state.project?.grids || []).find((g) => g.id === id) || null;
const kindTitle = (mode) => (mode === 'axis' ? 'по оси стены' : 'по грани');

// Свежая запись стены по ключу (после правки from могла смениться).
function freshWall(key, from) {
  const list = (state.walls || []).filter((w) => w.key === key);
  if (from === undefined || list.length < 2) return list[0] || null;
  return list.sort((a, b) => Math.abs(a.from - from) - Math.abs(b.from - from))[0];
}

function selectedWall() {
  const sel = state.selection;
  return sel?.type === 'wall' ? freshWall(sel.key, sel.from) : null;
}

// Прикрепить: стена встаёт на ось и запоминает её (одним шагом истории).
export function pinWall(wall, grid, { mode = planGridPref().snap, part = 'line', quiet = false } = {}) {
  if (!wall || !grid) return false;
  let res = null;
  mutate(() => { res = pinWallToGrid(state.project, wall, grid, { mode, part }); });
  if (!res?.ok) { toast(res?.reason || 'Прикрепить не получилось', true); return false; }
  if (!quiet) toast(`Стена прикреплена к оси ${grid.label} · двигайте ось — стена поедет с ней`);
  return true;
}

export function unpinWall(wall, gridId, part = 'line') {
  const g = gridById(gridId);
  let changed = false;
  mutate(() => { changed = unpinWallFromGrid(state.project, wall, gridId, part); });
  if (changed) toast(`Стена откреплена от оси ${g?.label || ''}`.trim());
  return changed;
}

// Клик по замку: закрыть (прикрепить) или открыть (открепить).
export function toggleGridLock(lock) {
  const wall = freshWall(lock.wallKey, lock.wallFrom);
  const grid = gridById(lock.gridId);
  hideLockTip();
  if (!wall || !grid) return;
  if (lock.closed) unpinWall(wall, grid.id, lock.part);
  else pinWall(wall, grid, { mode: lock.mode, part: lock.part });
}

// Кнопка «Прикрепить к оси»: ближайшая параллельная ось без ограничения радиуса.
export function pinSelectedWall(gridId = null, mode = planGridPref().snap) {
  const wall = selectedWall();
  if (!wall) return false;
  const grids = activeGrids();
  let grid = gridId ? grids.find((g) => g.id === gridId) : null;
  if (!grid) grid = nearestWallGrid(wallBody(wall), grids, mode)?.grid || null;
  if (!grid) { toast('Нет параллельной оси — поставьте ось (G)', true); return false; }
  return pinWall(wall, grid, { mode });
}

export function unpinSelectedWall() {
  const wall = selectedWall();
  if (!wall) return false;
  let changed = false;
  mutate(() => {
    for (const p of wallPins(state.project, wall)) changed = unpinWallFromGrid(state.project, wall, p.gridId, p.part) || changed;
  });
  if (changed) toast('Стена откреплена от оси');
  return changed;
}

export const selectedWallPins = () => {
  const wall = selectedWall();
  return wall ? wallPins(state.project, wall) : [];
};

// Конец жеста 'wall' (ui/input.js): стена притянута к оси магнитом и
// включено «запоминать» — прикрепить без отдельного шага истории.
export function rememberGridSnap(finished) {
  if (!planGridPref().remember) return;
  const grid = gridById(finished.gridSnap?.gridId);
  const wall = freshWall(finished.key, finished.from);
  if (!grid || !wall) return;
  const res = pinWallToGrid(state.project, wall, grid, { mode: planGridPref().snap });
  if (res.ok) refreshDerived();
}

// ---------------------------------------------------------------- «Свойства»

const partTitle = (part) => (part === 'line' ? '' : ` · торец ${part === 'a' ? 'начала' : 'конца'}`);

// Блок «Координационная ось» в «Свойствах» стены (ui/props.js).
export function wallPinBlock(wall) {
  const body = wallBody(wall);
  if (!body) return '';
  const pins = wallPins(state.project, wall);
  const parallel = activeGrids().filter((g) => g.kind === (body.orient === 'h' ? 'y' : 'x'))
    .sort((a, b) => Math.abs(a.at - body.mid) - Math.abs(b.at - body.mid));
  const rows = pins.map((p) => {
    const g = gridById(p.gridId);
    return `<div class="prop-row wall-pin-row" data-grid="${escapeHtml(p.gridId)}" data-part="${p.part}">
      <span>Привязана к оси ${escapeHtml(g?.label || '?')} · ${kindTitle(p.mode)}${partTitle(p.part)}</span>
      <button type="button" class="wall-unpin" data-grid="${escapeHtml(p.gridId)}" data-part="${p.part}">Отвязать</button></div>`;
  }).join('');
  const pinnedLine = pins.some((p) => p.part === 'line');
  const mode = planGridPref().snap;
  const picker = !pinnedLine && parallel.length ? `
      <label class="prop-field"><span>Ось</span>
        <select id="wallPinGrid">${parallel.map((g) => `<option value="${escapeHtml(g.id)}">${escapeHtml(g.label)} · ${g.kind} = ${Math.round(g.at)}</option>`).join('')}</select></label>
      <label class="prop-field"><span>Как</span>
        <select id="wallPinMode">
          <option value="face" ${mode === 'face' ? 'selected' : ''}>по грани</option>
          <option value="axis" ${mode === 'axis' ? 'selected' : ''}>по оси стены</option>
        </select></label>
      <button type="button" id="wallPinBtn">Прикрепить к оси</button>` : '';
  if (!rows && !picker) return '';
  return `
    <h3>Координационная ось</h3>
    <div class="prop-block" id="wallPinBlock">
      ${rows}${picker}
      <p class="hint">Прикреплённая стена едет вместе с осью, комнаты растягиваются. Замок на плане — то же одним кликом; Alt+перетаскивание — оторвать.</p>
    </div>`;
}

export function bindWallPinBlock(panel, wall) {
  const block = panel.querySelector('#wallPinBlock');
  if (!block) return;
  block.querySelector('#wallPinBtn')?.addEventListener('click', () => {
    const grid = gridById(block.querySelector('#wallPinGrid')?.value);
    pinWall(freshWall(wall.key, wall.kind === 'manual' ? undefined : wall.from), grid, { mode: block.querySelector('#wallPinMode')?.value || 'face' });
  });
  for (const b of block.querySelectorAll('.wall-unpin')) {
    b.addEventListener('click', () => unpinWall(freshWall(wall.key, wall.kind === 'manual' ? undefined : wall.from), b.dataset.grid, b.dataset.part));
  }
}

// ---------------------------------------------------------------- подсказка

let tip = null;

// Мгновенная подсказка у замка (как .tb-tip): «Прикрепить стену к оси 3».
export function showLockTip(lock, event) {
  if (!lock || !event || event.clientX === undefined) { hideLockTip(); return; }
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'plan-tip';
    tip.id = 'gridLockTip';
    tip.setAttribute('role', 'tooltip');
    document.body.appendChild(tip);
  }
  tip.textContent = lockTitle(lock);
  tip.style.left = `${event.clientX + 14}px`;
  tip.style.top = `${event.clientY + 16}px`;
  tip.hidden = false;
}

export function hideLockTip() {
  if (tip) tip.hidden = true;
}

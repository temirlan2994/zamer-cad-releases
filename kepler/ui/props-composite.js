// Панель свойств составной мебели (core/composite.js): стол со стульями.
// Размер предмета в основных полях — это размер столешницы; здесь —
// стулья: вид из библиотеки блоков, отступ, зазор, стороны.

import { blocksByGroup, furnitureBlock } from '../core/blocks.js';
import { chairsFit, compTypeFor, compositeParts, defaultComp, isRoundTable, normalizeComp } from '../core/composite.js';
import { escapeHtml } from './dom.js';
import { mutate } from './store.js';
import { selectObject } from './tools.js';

const SIDES = [['top', 'Сверху'], ['bottom', 'Снизу'], ['left', 'Слева'], ['right', 'Справа']];

// HTML блока настроек ('' — предмет не составной).
export function compositeSection(item) {
  if (compTypeFor(item.kind) !== 'dining') return '';
  const comp = normalizeComp(item.comp, item.kind);
  const on = Boolean(comp?.chair);
  const c = comp || defaultComp(item.kind);
  const chairs = blocksByGroup('chair');
  const options = [`<option value="" ${on ? '' : 'selected'}>— без стульев —</option>`,
    ...chairs.map((b) => `<option value="${escapeHtml(b.id)}" ${on && b.id === c.chair ? 'selected' : ''}>${escapeHtml(b.title)} · ${b.w}×${b.h}</option>`)];
  const total = compositeParts(item).length;
  const round = isRoundTable(item.kind);
  const block = furnitureBlock(c.chair) || furnitureBlock('chair');
  const sideRows = SIDES.map(([key, label]) => {
    const len = key === 'top' || key === 'bottom' ? item.w : item.h;
    const n = chairsFit(len, block.w, c.spacing);
    return `<label class="check-row"><input type="checkbox" data-comp-side="${key}" ${c.sides[key] ? 'checked' : ''} ${on ? '' : 'disabled'}><span>${label} (${n})</span></label>`;
  }).join('');
  return `
    <h3>Стулья</h3>
    <div class="prop-block" id="compDining">
      <label class="prop-field"><span>Вид стула</span><select id="compChair">${options.join('')}</select></label>
      <div class="prop-grid">
        <label class="prop-field"><span>Отступ от стола, мм</span>
          <input id="compOffset" type="number" step="10" value="${c.offset}" ${on ? '' : 'disabled'}></label>
        <label class="prop-field"><span>Зазор между, мм</span>
          <input id="compSpacing" type="number" step="10" min="0" value="${c.spacing}" ${on ? '' : 'disabled'}></label>
      </div>
      ${round ? `<label class="prop-field"><span>Стульев (0 — сколько влезет)</span>
          <input id="compCount" type="number" step="1" min="0" value="${c.count}" ${on ? '' : 'disabled'}></label>` : sideRows}
      <div class="prop-row"><span>Всего стульев</span><strong id="compTotal">${total}</strong></div>
      <p class="empty-hint">Отступ — от края стола до стула; меньше нуля — стул задвинут под стол. Растягивайте стол — число стульев пересчитается.</p>
    </div>`;
}

export function bindCompositeSection(panel, item) {
  const root = panel.querySelector('#compDining');
  if (!root) return;
  const apply = (fn) => {
    mutate(() => {
      const comp = normalizeComp(item.comp, item.kind) || defaultComp(item.kind);
      fn(comp);
      item.comp = normalizeComp(comp, item.kind);
    });
    selectObject({ type: 'item', id: item.id });
  };
  const val = (id) => Number(root.querySelector(id).value);
  root.querySelector('#compChair').addEventListener('change', (e) => apply((c) => { c.chair = e.target.value || null; }));
  root.querySelector('#compOffset').addEventListener('change', () => apply((c) => { c.offset = val('#compOffset'); }));
  root.querySelector('#compSpacing').addEventListener('change', () => apply((c) => { c.spacing = Math.max(0, val('#compSpacing')); }));
  root.querySelector('#compCount')?.addEventListener('change', () => apply((c) => { c.count = Math.max(0, val('#compCount')); }));
  for (const box of root.querySelectorAll('[data-comp-side]')) {
    box.addEventListener('change', () => apply((c) => { c.sides[box.dataset.compSide] = box.checked; }));
  }
}

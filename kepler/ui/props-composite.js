// Панель свойств составной мебели (core/composite.js).
// Стол со стульями: размер предмета в основных полях — это размер
// столешницы; здесь — стулья: вид из библиотеки блоков, отступ, зазор, стороны.
// Диван-конструктор: список модулей (тип, ширина, удалить), «Добавить модуль»
// и меню кнопок «+» на плане (openSofaMenu — из ui/input.js).

import { blocksByGroup, furnitureBlock } from '../core/blocks.js';
import {
  SOFA_MODULES, TYPES, chairsFit, compTypeFor, compositeParts, defaultComp, editSofa, isRoundTable, normalizeComp,
} from '../core/composite.js';
import { el, escapeHtml, toast } from './dom.js';
import { state } from './state.js';
import { mutate } from './store.js';
import { selectObject } from './tools.js';

const SIDES = [['top', 'Сверху'], ['bottom', 'Снизу'], ['left', 'Слева'], ['right', 'Справа']];

// HTML блока настроек ('' — предмет не составной).
export function compositeSection(item) {
  if (compTypeFor(item.kind) === 'sofa') return sofaSection(item);
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
  bindSofaSection(panel, item);
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

// --- Диван-конструктор ---------------------------------------------------

const MODULE_TYPES = Object.keys(SOFA_MODULES);

// Правка дивана с отменой (одна запись истории). false — не получилось.
export function applySofaEdit(item, edit) {
  const next = editSofa(item, edit);
  if (!next) {
    toast(edit.op === 'remove' ? 'Нельзя удалить единственный модуль' : 'Так не собрать: модули пересекаются');
    return false;
  }
  mutate(() => { Object.assign(item, next); });
  selectObject({ type: 'item', id: item.id });
  return true;
}

function sofaSection(item) {
  const comp = normalizeComp(item.comp, item.kind);
  if (!comp) {
    return `
    <h3>Модули дивана</h3>
    <div class="prop-block" id="compSofa">
      <p class="empty-hint">Обычный диван. Соберите его из модулей — сиденья, угол, подлокотники, пуф, шезлонг.</p>
      <button id="sofaMake">Собрать из модулей</button>
    </div>`;
  }
  const rows = comp.modules.map((m, i) => {
    const def = SOFA_MODULES[m.type];
    const opts = MODULE_TYPES.map((t) => `<option value="${t}" title="${escapeHtml(SOFA_MODULES[t].title)}" ${t === m.type ? 'selected' : ''}>${escapeHtml(SOFA_MODULES[t].short)}</option>`).join('');
    const width = m.type === 'corner'
      ? `<input type="number" value="${comp.depth}" disabled title="Угловой модуль — глубина × глубина">`
      : `<input type="number" data-sofa-w="${i}" step="50" min="${def.min}" max="${def.max}" value="${m.w}" aria-label="Ширина модуля ${i + 1}, мм">`;
    return `<div class="sofa-module-row" data-sofa-row="${i}">
      <span class="sofa-n">${i + 1}</span>
      <select data-sofa-type="${i}" aria-label="Тип модуля ${i + 1}">${opts}</select>
      ${width}
      <button class="danger" data-sofa-del="${i}" title="Удалить модуль" aria-label="Удалить модуль ${i + 1}" ${comp.modules.length <= 1 ? 'disabled' : ''}>×</button>
    </div>`;
  }).join('');
  const n = comp.modules.length;
  const whereOpts = [`<option value="${n}">в конец</option>`, '<option value="0">в начало</option>',
    ...comp.modules.slice(0, -1).map((_, i) => `<option value="${i + 1}">после ${i + 1}</option>`)].join('');
  const addOpts = MODULE_TYPES.map((t) => `<option value="${t}">${escapeHtml(SOFA_MODULES[t].title)}</option>`).join('');
  return `
    <h3>Модули дивана</h3>
    <div class="prop-block" id="compSofa">
      <div class="prop-row"><span>Модулей</span><strong id="sofaCount">${comp.modules.length}</strong></div>
      <label class="prop-field"><span>Глубина сиденья, мм</span>
        <input id="sofaDepth" type="number" step="50" min="500" max="1400" value="${comp.depth}"></label>
      <div class="sofa-modules" id="sofaModules">${rows}</div>
      <div class="prop-grid">
        <label class="prop-field"><span>Модуль</span><select id="sofaAddType">${addOpts}</select></label>
        <label class="prop-field"><span>Куда</span><select id="sofaAddAt">${whereOpts}</select></label>
      </div>
      <button id="sofaAdd">Добавить модуль</button>
      <p class="empty-hint">Ширина — вдоль спинки. Угловой модуль поворачивает диван; модули не должны пересекаться.</p>
    </div>`;
}

function bindSofaSection(panel, item) {
  const root = panel.querySelector('#compSofa');
  if (!root) return;
  root.querySelector('#sofaMake')?.addEventListener('click', () => {
    const comp = defaultComp(item.kind);
    mutate(() => { item.comp = comp; TYPES.sofa.fit(item, comp); });
    selectObject({ type: 'item', id: item.id });
  });
  root.querySelector('#sofaDepth')?.addEventListener('change', (e) => applySofaEdit(item, { op: 'depth', value: Number(e.target.value) }));
  root.querySelector('#sofaAdd')?.addEventListener('click', () => {
    applySofaEdit(item, { op: 'insert', at: Number(root.querySelector('#sofaAddAt').value), type: root.querySelector('#sofaAddType').value });
  });
  for (const sel of root.querySelectorAll('[data-sofa-type]')) {
    sel.addEventListener('change', () => {
      if (!applySofaEdit(item, { op: 'set', index: Number(sel.dataset.sofaType), type: sel.value })) selectObject({ type: 'item', id: item.id });
    });
  }
  for (const inp of root.querySelectorAll('[data-sofa-w]')) {
    inp.addEventListener('change', () => {
      if (!applySofaEdit(item, { op: 'set', index: Number(inp.dataset.sofaW), w: Number(inp.value) })) selectObject({ type: 'item', id: item.id });
    });
  }
  for (const btn of root.querySelectorAll('[data-sofa-del]')) {
    btn.addEventListener('click', () => applySofaEdit(item, { op: 'remove', index: Number(btn.dataset.sofaDel) }));
  }
}

// Меню выбора модуля у кнопки «+» на плане (координаты — экранные, px):
// на торце — модуль к концу цепочки, на стыке — вставка между модулями.
export function openSofaMenu(item, spot) {
  const menu = el('sofaMenu');
  menu.innerHTML = MODULE_TYPES.map((t) => `<button type="button" role="menuitem" data-sofa-add="${t}">${escapeHtml(SOFA_MODULES[t].title)}</button>`).join('');
  menu.style.left = `${spot.x}px`;
  menu.style.top = `${spot.y + (spot.r || 0)}px`;
  menu.hidden = false;
  state.sofaMenu = { itemId: item.id, at: spot.at };
  for (const btn of menu.querySelectorAll('[data-sofa-add]')) {
    btn.addEventListener('click', () => {
      const target = state.project.items.find((i) => i.id === state.sofaMenu?.itemId);
      const at = state.sofaMenu?.at;
      hideSofaMenu();
      if (target) applySofaEdit(target, { op: 'insert', at, type: btn.dataset.sofaAdd });
    });
  }
}

export function hideSofaMenu() {
  const menu = el('sofaMenu');
  if (menu) menu.hidden = true;
  state.sofaMenu = null;
}

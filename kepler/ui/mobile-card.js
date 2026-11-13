// Телефон: выбранный объект — карточка вверху плана (#mobileCard, поверх
// плана: он не сдвигается) вместо плашки действий. В карточке: название, два главных размера
// (поля пересылают ввод в такие же поля «Свойств» — логика правки одна,
// ui/props.js), площадь или длина, кнопка «Свойства» и действия
// (#selectionToolbar переезжает сюда, обработчики — ui/selection-toolbar.js).
// На компьютере панель действий возвращается на холст. Пока открыт нижний
// лист, карточка скрыта (лист её заменяет).

import { el } from './dom.js';

// Поля «Свойств», которые показываются в карточке (первые два найденных).
const CHIP_FIELDS = [
  ['roomW', 'Ш'], ['roomH', 'Г'], ['itemW', 'Ш'], ['itemH', 'Г'], ['openW', 'Ш'], ['openH', 'В'],
  ['slabW', 'Ш'], ['slabH', 'Г'], ['railLength', 'Д'], ['railHeight', 'В'], ['wallT', 'Т'],
];
const INFO_ROW = /^(Площадь|Длина)/;

let opts = null; // { isPhone, sheetOpen, openProps, ensurePropsTab }
let home = null; // место панели действий на компьютере

// Панель действий: на телефоне — в карточке, на компьютере — на холсте.
function placeToolbar() {
  const bar = el('selectionToolbar');
  const acts = el('mobileCard')?.querySelector('.mc-acts');
  if (!bar || !acts || !home) return;
  if (opts.isPhone()) { if (bar.parentElement !== acts) acts.appendChild(bar); return; }
  if (bar.parentElement !== home.parent) home.parent.insertBefore(bar, home.next);
}

// --card-h (на body): под карточкой — этажи, «⚠» и подсказка инструмента.
function setCardHeight(px) {
  const v = `${Math.round(px)}px`;
  if (document.body.style.getPropertyValue('--card-h') !== v) document.body.style.setProperty('--card-h', v);
}

// Заголовок «Свойств» без значков («внутри «Спальня»»). Если «Свойства»
// показывают вид или лист (объект другого режима), — название из панели действий.
function titleOf(body) {
  const h2 = body?.querySelector('h2');
  const own = h2 ? [...h2.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim() : '';
  const label = el('selectionToolbar')?.querySelector('.selection-toolbar-label')?.textContent.trim() || '';
  return own && !/^(Вид|Лист)(?![а-яё])/i.test(own) ? own : label || own;
}

// Площадь — числом с м²; длина — с подписью (иначе не отличить от полей).
function infoOf(body) {
  for (const row of body?.querySelectorAll('.prop-row') || []) {
    const label = row.querySelector('span')?.textContent.trim() || '';
    if (!INFO_ROW.test(label)) continue;
    const value = row.querySelector('strong')?.textContent.trim() || '';
    return label.startsWith('Длина') && value ? `Длина ${value}` : value;
  }
  return '';
}

function syncChips(card, body) {
  const box = card.querySelector('.mc-chips');
  if (box.contains(document.activeElement)) return; // печатают — не перестраивать
  const fields = [];
  for (const [id, short] of CHIP_FIELDS) {
    const src = body?.querySelector(`#${id}`);
    if (src && fields.length < 2) fields.push({ id, short, value: src.value, readonly: src.readOnly, min: src.min, step: src.step });
  }
  const key = JSON.stringify(fields);
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  box.replaceChildren(...fields.map((f) => {
    const label = document.createElement('label');
    label.className = 'mc-chip';
    const small = document.createElement('small');
    small.textContent = f.short;
    const input = document.createElement('input');
    input.type = 'number';
    input.inputMode = 'numeric';
    input.dataset.field = f.id;
    input.value = f.value;
    if (f.min) input.min = f.min;
    if (f.step) input.step = f.step;
    input.readOnly = f.readonly;
    input.setAttribute('aria-label', `${f.short}, мм`);
    label.append(small, input);
    return label;
  }));
}

export function syncMobileCard() {
  const card = el('mobileCard');
  const bar = el('selectionToolbar');
  if (!card || !bar || !opts) return;
  placeToolbar();
  const show = opts.isPhone() && !bar.hidden && !opts.sheetOpen();
  if (show) opts.ensurePropsTab(); // размеры берутся из полей «Свойств» выбранного объекта
  card.hidden = !show;
  if (!show) { setCardHeight(0); return; }
  const body = el('propsBody');
  const title = titleOf(body);
  const t = el('mobileCardTitle');
  if (t.textContent !== title) t.textContent = title;
  const info = infoOf(body);
  const i = card.querySelector('.mc-info');
  if (i.textContent !== info) i.textContent = info;
  syncChips(card, body);
  setCardHeight(card.getBoundingClientRect().height);
}

export function bindMobileCard(options) {
  opts = options;
  const card = el('mobileCard');
  const bar = el('selectionToolbar');
  if (!card || !bar) return;
  home = { parent: bar.parentElement, next: bar.nextElementSibling };
  el('mobileCardProps')?.addEventListener('click', () => opts.openProps());
  const chips = card.querySelector('.mc-chips');
  chips.addEventListener('change', (e) => {
    const input = e.target.closest('input[data-field]');
    const src = input && el('propsBody')?.querySelector(`#${input.dataset.field}`);
    if (!src || src.readOnly) return;
    src.value = input.value;
    src.dispatchEvent(new Event('change', { bubbles: true }));
  });
  chips.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); }); // Enter — применить, клавиатура уходит
  chips.addEventListener('focusout', () => setTimeout(syncMobileCard, 0)); // после ввода — новые значения
  placeToolbar();
}

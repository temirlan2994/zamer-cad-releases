// Телефон: холст во весь экран, а библиотека («Помещения» / «Участок»,
// «Мебель») и «Свойства» выезжают снизу по кнопкам нижней панели
// (#mobileBar). На больших экранах панель скрыта и классы ни на что не
// влияют (см. @media в styles.css).

import { el } from './dom.js';
import { applyLibraryTab } from './library.js';
import { state } from './state.js';

const LIB = 'sheet-library';
const PROPS = 'sheet-props';
const has = (cls) => document.body.classList.contains(cls);

function libraryKindActive(kind) {
  if (!has(LIB)) return false;
  if (state.modeName === 'site') return kind === 'rooms';
  return (state.libraryTab === 'furniture') === (kind === 'furniture');
}

// Кнопка нижней панели: открыть нужную выдвижную панель или закрыть её,
// если она уже открыта.
export function toggleSheet(kind) {
  const already = kind === 'props' ? has(PROPS) : libraryKindActive(kind);
  document.body.classList.remove(LIB, PROPS);
  if (!already) {
    if (kind !== 'props' && state.modeName === 'plan') {
      state.libraryTab = kind === 'furniture' ? 'furniture' : 'rooms';
      applyLibraryTab();
    }
    document.body.classList.add(kind === 'props' ? PROPS : LIB);
  }
  syncMobileBar();
}

// Нажали на план или выбрали помещение для размещения — библиотека уезжает,
// чтобы освободить план.
export function closeLibrarySheet() {
  if (!has(LIB)) return;
  document.body.classList.remove(LIB);
  syncMobileBar();
}

export function syncMobileBar() {
  const bar = el('mobileBar');
  if (!bar || !state.project) return;
  const site = state.modeName === 'site';
  const btn = (kind) => bar.querySelector(`[data-sheet="${kind}"]`);
  btn('rooms').textContent = site ? 'Участок' : 'Помещения';
  btn('furniture').hidden = site;
  for (const kind of ['rooms', 'furniture']) btn(kind).classList.toggle('active', libraryKindActive(kind));
  btn('props').classList.toggle('active', has(PROPS));
  btn('props').classList.toggle('dot', Boolean(state.selection)); // есть что смотреть
}

export function bindMobile() {
  el('mobileBar')?.querySelectorAll('[data-sheet]').forEach((b) => {
    b.addEventListener('click', () => toggleSheet(b.dataset.sheet));
  });
}

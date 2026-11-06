// Телефон: холст во весь экран, а библиотека («Помещения» / «Участок»,
// «Мебель») и «Свойства» выезжают снизу по кнопкам нижней панели
// (#mobileBar). На больших экранах панель скрыта и классы ни на что не
// влияют (см. @media в styles.css).

import { el } from './dom.js';
import { applyLibraryTab } from './library.js';
import { state } from './state.js';
import { renderToolstrip } from './toolstrip.js';

const LIB = 'sheet-library';
const PROPS = 'sheet-props';
const has = (cls) => document.body.classList.contains(cls);

function libraryKindActive(kind) {
  if (!has(LIB)) return false;
  if (state.modeName !== 'plan') return kind === 'rooms';
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
  renderToolstrip(); // «Мебель» на панели инструментов — по открытому каталогу
}

// Телефонная раскладка (как @media (max-width: 640px) в styles.css).
export const isPhone = () => Boolean(globalThis.matchMedia?.('(max-width: 640px)').matches);

// Выбрали инструмент на панели инструментов — обе выдвижные панели уезжают.
export function closeSheets() {
  if (!has(LIB) && !has(PROPS)) return;
  document.body.classList.remove(LIB, PROPS);
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
  const site = state.modeName !== 'plan';
  const btn = (kind) => bar.querySelector(`[data-sheet="${kind}"]`);
  btn('rooms').textContent = state.modeName === 'landscape' ? 'Ландшафт' : site ? 'Участок' : 'Помещения';
  btn('furniture').hidden = site;
  // «Участок»: инструменты — на панели инструментов, каталога нет.
  btn('rooms').hidden = state.modeName === 'site';
  for (const kind of ['rooms', 'furniture']) btn(kind).classList.toggle('active', libraryKindActive(kind));
  btn('props').classList.toggle('active', has(PROPS));
  btn('props').classList.toggle('dot', Boolean(state.selection)); // есть что смотреть
}

// Экранная клавиатура на телефоне перекрывает нижнюю панель: считаем её высоту
// по visualViewport и поднимаем панель над клавиатурой (--kb, --vvh в CSS),
// а выбранное поле прокручиваем в видимую часть.
function bindKeyboardInset() {
  const vv = window.visualViewport;
  if (!vv) return;
  const root = document.documentElement;
  const update = () => {
    const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    root.style.setProperty('--kb', `${kb}px`);
    root.style.setProperty('--vvh', `${Math.round(vv.height)}px`);
    document.body.classList.toggle('kb-open', kb > 80);
  };
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
  update();
  document.addEventListener('focusin', (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement) || !t.closest('.props, .library')) return;
    setTimeout(() => { try { t.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch { /* старый браузер */ } }, 320);
  });
}

export function bindMobile() {
  bindKeyboardInset();
  el('mobileBar')?.querySelectorAll('[data-sheet]').forEach((b) => {
    b.addEventListener('click', () => toggleSheet(b.dataset.sheet));
  });
}

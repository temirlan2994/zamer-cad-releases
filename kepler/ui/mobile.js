// Телефон (≤640px): холст во весь экран; снизу — лента инструментов с
// подписями (#toolStrip) и нижняя навигация (#mobileBar): «Помещения»
// (каталог; в «Ландшафте» — «Ландшафт»), «Свойства», «Виды», «Листы», «3D»,
// «Ещё». Каталог, правая панель и «Ещё» (#mobileMore) — нижние листы над
// лентой: ручка сверху (тянуть — 45% / 88% высоты, вниз — закрыть) и «✕».
// На больших экранах навигация, «Ещё» и ручки скрыты, классы ни на что не
// влияют (см. @media в styles.css).

import { el } from './dom.js';
import { applyLibraryTab } from './library.js';
import { state } from './state.js';
import { renderToolstrip } from './toolstrip.js';

const LIB = 'sheet-library';
const PROPS = 'sheet-props';
const MORE = 'sheet-more';
const TALL = 'sheet-tall';
const SHEETS = [LIB, PROPS, MORE];
const has = (cls) => document.body.classList.contains(cls);
const anySheet = () => SHEETS.some(has);

function libraryKindActive(kind) {
  if (!has(LIB)) return false;
  if (state.modeName !== 'plan') return kind === 'rooms';
  return (state.libraryTab === 'furniture') === (kind === 'furniture');
}

// Вкладка правой панели, к которой относится кнопка навигации.
const PANEL_TAB = { props: 'props', views: 'views', sheets: 'sheets' };
const navTab = () => (['views', 'sheets'].includes(state.propsTab) ? state.propsTab : 'props');

function setPropsTab(tab) {
  if (state.propsTab === tab && !el('issuesBtn')?.getAttribute('aria-expanded')?.includes('true')) return;
  const id = { props: 'propsTabMain', views: 'propsTabViews', sheets: 'propsTabSheets', tep: 'propsTabTep' }[tab];
  el(id)?.click(); // обработчик вкладок (ui/props.js) — закрывает замечания и перерисовывает
}

function closeAll() {
  document.body.classList.remove(...SHEETS, TALL);
}

// Кнопка нижней панели: открыть нужный лист или закрыть его, если он уже
// открыт. kind: 'rooms' | 'furniture' | 'props' | 'views' | 'sheets' | 'more' | '3d'.
export function toggleSheet(kind) {
  if (kind === '3d') {
    closeAll();
    el('view3dBtn')?.click();
    syncMobileBar();
    return;
  }
  let already;
  if (PANEL_TAB[kind]) already = has(PROPS) && navTab() === PANEL_TAB[kind];
  else if (kind === 'more') already = has(MORE);
  else already = libraryKindActive(kind);
  const tall = has(TALL);
  closeAll();
  if (!already) {
    if (PANEL_TAB[kind]) {
      setPropsTab(PANEL_TAB[kind]);
      document.body.classList.add(PROPS);
    } else if (kind === 'more') {
      document.body.classList.add(MORE);
    } else {
      if (state.modeName === 'plan') {
        state.libraryTab = kind === 'furniture' ? 'furniture' : 'rooms';
        applyLibraryTab();
      }
      document.body.classList.add(LIB);
    }
    if (tall) document.body.classList.add(TALL); // высота листа сохраняется при смене вкладки
  }
  syncMobileBar();
  renderToolstrip(); // «Мебель» на панели инструментов — по открытому каталогу
}

// Открыть каталог (без переключения): «Помещение», «Дверь», «Окно» на ленте.
export function openLibrarySheet() {
  if (!isPhone() || has(LIB)) return;
  closeAll();
  document.body.classList.add(LIB);
  syncMobileBar();
}

// Телефонная раскладка (как @media (max-width: 640px) в styles.css).
export const isPhone = () => Boolean(globalThis.matchMedia?.('(max-width: 640px)').matches);

// Выбрали инструмент на панели инструментов — выдвижные панели уезжают.
export function closeSheets() {
  if (!anySheet()) return;
  closeAll();
  syncMobileBar();
}

// Нажали на план или выбрали помещение для размещения — библиотека уезжает,
// чтобы освободить план.
export function closeLibrarySheet() {
  if (!has(LIB)) return;
  document.body.classList.remove(LIB, TALL);
  syncMobileBar();
}

export function syncMobileBar() {
  const bar = el('mobileBar');
  if (!bar || !state.project) return;
  const btn = (kind) => bar.querySelector(`[data-sheet="${kind}"]`);
  const lib = btn('rooms');
  if (lib) {
    const label = lib.querySelector('.mb-label') || lib;
    const text = state.modeName === 'landscape' ? 'Ландшафт' : state.tool?.kind === 'place-opening' ? 'Проёмы' : 'Каталог';
    if (label.textContent !== text) label.textContent = text;
    // «Участок»: инструменты — на ленте, каталога нет.
    lib.hidden = state.modeName === 'site';
    lib.classList.toggle('active', has(LIB));
  }
  const props = has(PROPS);
  for (const kind of ['props', 'views', 'sheets']) btn(kind)?.classList.toggle('active', props && navTab() === kind);
  btn('props')?.classList.toggle('dot', Boolean(state.selection)); // есть что смотреть
  btn('more')?.classList.toggle('active', has(MORE));
  btn('3d')?.classList.toggle('active', Boolean(el('view3dBtn')?.classList.contains('active')));
  for (const b of bar.querySelectorAll('[data-sheet]')) b.setAttribute('aria-pressed', String(b.classList.contains('active')));
  el('moreBtn')?.setAttribute('aria-expanded', String(has(MORE)));
  const more = el('mobileMore');
  if (more) {
    for (const b of more.querySelectorAll('.mm-modes [data-more]')) b.classList.toggle('active', b.dataset.more === state.modeName);
  }
  ensureSnapMenu();
}

// Привязки на телефоне — одна кнопка «магнит»; касание раскрывает ряд.
function ensureSnapMenu() {
  const bar = el('snapBar');
  if (!bar || !bar.querySelector('[data-snap]') || bar.querySelector('.snap-menu')) return;
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'snap-btn snap-menu';
  b.setAttribute('aria-label', 'Привязки');
  b.setAttribute('aria-expanded', 'false');
  b.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h4v8a2 2 0 0 0 4 0V3h4v8a6 6 0 0 1-12 0z"/><path d="M6 7h4M14 7h4"/></svg><span class="snap-menu-label">Привязки</span>';
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = !bar.classList.contains('open');
    bar.classList.toggle('open', open);
    b.setAttribute('aria-expanded', String(open));
  });
  bar.prepend(b);
}

// Ручка листа: тянуть вверх/вниз — высота (45% / 88%), сильно вниз — закрыть;
// «✕» — закрыть.
function attachGrip(panel, onClose) {
  if (!panel || panel.querySelector(':scope > .sheet-grip')) return;
  const grip = document.createElement('div');
  grip.className = 'sheet-grip';
  grip.innerHTML = '<span class="sheet-handle" aria-hidden="true"></span><button type="button" class="sheet-close" aria-label="Закрыть">✕</button>';
  panel.prepend(grip);
  grip.querySelector('.sheet-close').addEventListener('click', (e) => { e.stopPropagation(); onClose(); });
  let drag = null;
  grip.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.sheet-close')) return;
    const host = panel.parentElement.getBoundingClientRect();
    drag = { id: e.pointerId, y: e.clientY, h: panel.getBoundingClientRect().height, max: host.height, moved: false };
    grip.setPointerCapture?.(e.pointerId);
    panel.style.transition = 'none';
  });
  grip.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = e.clientY - drag.y;
    if (Math.abs(dy) > 4) drag.moved = true;
    panel.style.height = `${Math.max(80, Math.min(drag.max, drag.h - dy))}px`;
  });
  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = e.clientY - drag.y;
    const h = drag.h - dy;
    const moved = drag.moved;
    const max = drag.max;
    drag = null;
    panel.style.transition = '';
    panel.style.height = '';
    if (!moved) { document.body.classList.toggle(TALL); return; } // касание ручки — сменить высоту
    if (dy > 60 && h < max * 0.35) { onClose(); return; }
    document.body.classList.toggle(TALL, h > max * 0.62);
  };
  grip.addEventListener('pointerup', end);
  grip.addEventListener('pointercancel', end);
}

// Пункты листа «Ещё» — кнопки шапки, скрытые на телефоне.
function bindMore() {
  const more = el('mobileMore');
  if (!more) return;
  const click = (id) => el(id)?.click();
  const ACTIONS = {
    plan: () => click('modePlanBtn'),
    site: () => click('modeSiteBtn'),
    landscape: () => click('landscapeBtn'),
    projects: () => click('projectsBtn'),
    export: () => click('exportBtn'),
    menu: () => click('menuBtn'),
    theme: () => click('themeBtn'),
    help: () => click('helpBtn'),
  };
  more.addEventListener('click', (e) => {
    const b = e.target.closest('[data-more]');
    if (!b) return;
    e.stopPropagation(); // иначе тот же клик закроет меню «Экспорт» (ui/toolbar.js)
    const key = b.dataset.more;
    if (key === 'theme') { ACTIONS.theme(); return; } // лист остаётся: видно, как сменилась тема
    closeSheets();
    if (key === 'tep') { setPropsTab('tep'); document.body.classList.add(PROPS); syncMobileBar(); return; }
    if (key === 'issues') { click('issuesBtn'); return; }
    ACTIONS[key]?.();
    syncMobileBar();
  });
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
  el('moreBtn')?.addEventListener('click', () => toggleSheet('more'));
  attachGrip(document.querySelector('.library'), () => closeSheets());
  attachGrip(el('propsPanel'), () => closeSheets());
  attachGrip(el('mobileMore'), () => closeSheets());
  bindMore();
  // 3D, смена режима или вида (дерево видов, клавиши) — подсветка навигации.
  document.addEventListener('kepler:view', () => syncMobileBar());
  el('view3dBtn')?.addEventListener('click', () => setTimeout(syncMobileBar, 0));
}

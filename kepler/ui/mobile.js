// Телефон (≤640px): сверху — ряд привязок (#mobileSnapRow, всегда открыт),
// слева — колонка инструментов (#toolStrip: выбор, стена, масса, крыша…),
// внизу — навигация (#mobileBar): «Каталог» (в «Ландшафте» — «Ландшафт»),
// «Свойства», «Виды», «Листы», «3D», «Ещё». «Каталог» выдвигает второй ряд
// (#mobileCat): Помещение · Мебель · Окно · Дверь · Лестница; касание —
// библиотека нижним листом. Листы (каталог, правая панель, «Ещё», формы
// лестниц) — над вторым рядом: ручка (45% / 88% высоты, вниз — закрыть) и «✕».
// На больших экранах навигация, «Ещё» и ручки скрыты, классы ни на что не
// влияют (см. @media в styles.css).

import { el } from './dom.js';
import { applyLibraryTab } from './library.js';
import { state } from './state.js';
import { renderToolstrip } from './toolstrip.js';
import { STAIR_SHAPES } from '../core/stairs.js';
import { cancelTool, startPlaceFurniture } from './tools.js';
import { finishWallChain } from './wall-tool.js';

const LIB = 'sheet-library';
const PROPS = 'sheet-props';
const MORE = 'sheet-more';
const STAIRS = 'sheet-stairs';
const TALL = 'sheet-tall';
const CAT = 'cat-open';
const SHEETS = [LIB, PROPS, MORE, STAIRS];
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
  // «Каталог» в «Плане» — второй ряд (помещение, мебель, окно, дверь, лестница).
  if (kind === 'rooms' && state.modeName === 'plan') {
    const open = !has(CAT);
    document.body.classList.toggle(CAT, open);
    if (!open) closeAll();
    syncMobileBar();
    return;
  }
  if (kind !== 'furniture' && kind !== 'stairs') document.body.classList.remove(CAT);
  if (kind === '3d') {
    closeAll();
    el('view3dBtn')?.click();
    syncMobileBar();
    return;
  }
  let already;
  if (PANEL_TAB[kind]) already = has(PROPS) && navTab() === PANEL_TAB[kind];
  else if (kind === 'more') already = has(MORE);
  else if (kind === 'stairs') already = has(STAIRS);
  else already = libraryKindActive(kind);
  const tall = has(TALL);
  closeAll();
  if (!already) {
    if (PANEL_TAB[kind]) {
      setPropsTab(PANEL_TAB[kind]);
      document.body.classList.add(PROPS);
    } else if (kind === 'more') {
      document.body.classList.add(MORE);
    } else if (kind === 'stairs') {
      document.body.classList.add(STAIRS);
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
    const text = state.modeName === 'landscape' ? 'Ландшафт' : 'Каталог';
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
  if (lib && state.modeName === 'plan') lib.classList.toggle('active', has(CAT));
  syncCatRow(state.modeName === 'plan');
  for (const b of bar.querySelectorAll('[data-sheet]')) b.setAttribute('aria-pressed', String(b.classList.contains('active')));
  el('moreBtn')?.setAttribute('aria-expanded', String(has(MORE)));
  const more = el('mobileMore');
  if (more) {
    for (const b of more.querySelectorAll('.mm-modes [data-more]')) b.classList.toggle('active', b.dataset.more === state.modeName);
  }
}

// Привязки на телефоне — ряд под шапкой, все кнопки сразу видны: #snapBar
// переносится в #mobileSnapRow; на компьютере — обратно в строку состояния.
function placeSnapBar() {
  const bar = el('snapBar');
  const row = el('mobileSnapRow');
  if (!bar || !row) return;
  if (isPhone()) { if (bar.parentElement !== row) row.appendChild(bar); return; }
  const status = document.querySelector('.statusbar');
  if (status && bar.parentElement !== status) status.insertBefore(bar, el('scaleInfo'));
}

// Второй ряд «Каталога»: значки берутся у кнопок колонки инструментов (их
// обработчики — ui/toolbar.js, ui/toolstrip.js).
const CAT_ITEMS = [
  { id: 'room', label: 'Помещение', src: 'boundRoomBtn' },
  { id: 'furniture', label: 'Мебель', src: 'furnitureToolBtn' },
  { id: 'window', label: 'Окно', src: 'windowToolBtn' },
  { id: 'door', label: 'Дверь', src: 'doorToolBtn' },
  { id: 'stairs', label: 'Лестница', src: 'stairsToolBtn' },
];

function buildCatRow() {
  const row = el('mobileCat');
  if (!row || row.childElementCount) return;
  for (const it of CAT_ITEMS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.cat = it.id;
    b.setAttribute('aria-label', it.label);
    const icon = el(it.src)?.querySelector('svg')?.cloneNode(true);
    if (icon) { icon.setAttribute('width', '22'); icon.setAttribute('height', '22'); b.appendChild(icon); }
    const span = document.createElement('span');
    span.className = 'mb-label';
    span.textContent = it.label;
    b.appendChild(span);
    row.appendChild(b);
  }
  row.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cat]');
    if (b) pickCatalog(b.dataset.cat);
  });
}

function pickCatalog(id) {
  const t = state.tool;
  if (id === 'furniture') { toggleSheet('furniture'); renderToolstrip(); return; }
  if (id === 'stairs') {
    if (t?.kind === 'place-furniture' && t.itemKind === 'stairs' && !has(STAIRS)) { el('stairsToolBtn')?.click(); return; }
    if (t && !(t.kind === 'place-furniture' && t.itemKind === 'stairs') && !finishWallChain()) cancelTool();
    toggleSheet('stairs');
    renderToolstrip();
    return;
  }
  const src = CAT_ITEMS.find((c) => c.id === id)?.src;
  el(src)?.click();
  // Дверь / окно: каталог проёмов — нижним листом; касание плана его убирает.
  if ((id === 'door' || id === 'window') && state.tool?.kind === 'place-opening') openLibrarySheet();
}

function catActive(id) {
  const t = state.tool;
  if (id === 'room') return t?.kind === 'bound-room' || t?.kind === 'place-room' || (!t && libraryKindActive('rooms'));
  if (id === 'furniture') return libraryKindActive('furniture') || (t?.kind === 'place-furniture' && t.itemKind !== 'stairs');
  if (id === 'door' || id === 'window') return t?.kind === 'place-opening' && t.openKind === id;
  if (id === 'stairs') return has(STAIRS) || (t?.kind === 'place-furniture' && t.itemKind === 'stairs');
  return false;
}

function syncCatRow(plan) {
  const row = el('mobileCat');
  if (!row) return;
  if (!plan) document.body.classList.remove(CAT);
  row.hidden = !has(CAT);
  for (const b of row.querySelectorAll('[data-cat]')) {
    const on = catActive(b.dataset.cat);
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  }
}

// Лист «Лестница»: выбор формы, затем касание плана — поставить.
const STAIR_ICONS = {
  straight: '<rect x="8" y="2.5" width="8" height="19" rx="1"/><path d="M8 6.5h8M8 10.5h8M8 14.5h8M8 18.5h8"/>',
  l: '<path d="M4 21.5V12h8V2.5h8v19z"/><path d="M4 16.5h8M12 7h8M12 12h8M12 16.5h8"/>',
  u: '<path d="M3 21.5V2.5h18v19h-7V9h-4v12.5z"/><path d="M3 15h7M3 9h7M14 15h7M14 9h7"/>',
  u3: '<path d="M3 21.5V2.5h18v19h-6V8.5H9v13z"/><path d="M3 15h6M15 15h6M9 2.5v6M15 2.5v6"/>',
};
function buildStairsSheet() {
  const box = el('mobileStairs');
  if (!box || box.querySelector('.ms-grid')) return;
  const h = document.createElement('h3');
  h.className = 'mm-title';
  h.textContent = 'Лестница — форма';
  const grid = document.createElement('div');
  grid.className = 'mm-grid ms-grid';
  grid.innerHTML = STAIR_SHAPES.map((sh) => `<button type="button" data-stair="${sh.id}">
    <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true">${STAIR_ICONS[sh.id] || ''}</svg>${sh.title}</button>`).join('');
  const note = document.createElement('p');
  note.className = 'empty-hint';
  note.textContent = 'Тип конструкции (закрытая, открытая, консольная) и размеры — в «Свойствах» после установки.';
  box.append(h, grid, note);
  grid.addEventListener('click', (e) => {
    const b = e.target.closest('[data-stair]');
    if (!b) return;
    e.stopPropagation();
    if (state.tool?.kind === 'wall') finishWallChain();
    const sh = STAIR_SHAPES.find((x) => x.id === b.dataset.stair);
    startPlaceFurniture('stairs', `Лестница: ${sh?.title || ''}`);
    if (state.tool) state.tool.stairShape = b.dataset.stair;
    closeAll();
    renderToolstrip();
  });
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
  buildCatRow();
  buildStairsSheet();
  attachGrip(el('mobileStairs'), () => closeSheets());
  placeSnapBar();
  globalThis.matchMedia?.('(max-width: 640px)').addEventListener?.('change', () => { placeSnapBar(); syncMobileBar(); });
  bindMore();
  // 3D, смена режима или вида (дерево видов, клавиши) — подсветка навигации.
  document.addEventListener('kepler:view', () => syncMobileBar());
  el('view3dBtn')?.addEventListener('click', () => setTimeout(syncMobileBar, 0));
}

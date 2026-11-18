// Телефон (≤640px): план во всю ширину. Привязки открываются в строке видов. Внизу —
// навигация (#mobileBar): «Рисовать» · «Каталог» (в «Ландшафте» —
// «Ландшафт») · «Свойства» · «Листы». «Рисовать» выдвигает второй ряд
// (#mobileDraw) с инструментами режима. Родственные инструменты плана
// («Проёмы», «Масса», «Документация») раскрываются отдельным рядом
// иконок над лентой; в «Участке» и «Ландшафте» остаются свои инструменты.
// «Каталог» (#mobileCat): Комнаты · Мебель · Лестницы · Готово.
// Кнопки рядов — зеркала кнопок колонки инструментов (#toolStrip скрыт, его
// обработчики работают). В открытом каталоге второй ряд уступает место карточкам.
// Свайп или нажатие на ручку меняет высоту листа, «✕» его закрывает.
// В шапке листов (#mobileSheetHead) доступны виды для оформления. Выбранный объект —
// карточка вверху плана (ui/mobile-card.js), под ней — этажи и «⚠»;
// «Вписать» — круглая кнопка на плане.
// На больших экранах всё это скрыто, классы ни на что не влияют (styles.css).

import { el } from './dom.js';
import { applyLibraryTab } from './library.js';
import { stairPresetCard } from './stair-library.js';
import { state } from './state.js';
import { availableModelTool, getPlanToolFamilies, renderToolstrip, toolContext } from './toolstrip.js';
import { STAIR_SHAPES, STAIR_STYLE_PRESETS } from '../core/stairs.js';
import { cancelTool, startPlaceFurniture } from './tools.js';
import { finishWallChain } from './wall-tool.js';
import { bindMobileCard, syncMobileCard } from './mobile-card.js';
import { bindTouchHints } from './touch-hints.js';

const LIB = 'sheet-library';
const PROPS = 'sheet-props';
const MORE = 'sheet-more';
const STAIRS = 'sheet-stairs';
const TALL = 'sheet-tall';
const CAT = 'cat-open';
const DRAW = 'draw-open';
const SHEETS = [LIB, PROPS, MORE, STAIRS];
const has = (cls) => document.body.classList.contains(cls);
const anySheet = () => SHEETS.some(has);

function libraryKindActive(kind) {
  if (!has(LIB)) return false;
  if (state.modeName !== 'plan') return kind === 'rooms';
  if (state.tool?.kind === 'place-opening') return false;
  return (state.libraryTab === 'furniture') === (kind === 'furniture');
}

// Мобильная кнопка «Листы» открывает листы и дерево видов для их оформления.
const PANEL_TAB = { props: 'props', views: 'views', sheets: 'sheets' };
const navTab = () => (['views', 'sheets'].includes(state.propsTab) ? state.propsTab : 'props');
const viewsTab = () => navTab() !== 'props';

function setPropsTab(tab) {
  if (state.propsTab === tab && !el('issuesBtn')?.getAttribute('aria-expanded')?.includes('true')) return;
  const id = { props: 'propsTabMain', views: 'propsTabViews', sheets: 'propsTabSheets' }[tab];
  el(id)?.click(); // обработчик вкладок (ui/props.js) — закрывает замечания и перерисовывает
}

function closeAll() {
  document.body.classList.remove(...SHEETS, TALL);
  closeMobileToolFlyout();
}

// Кнопка нижней панели: открыть нужный лист или ряд, повторно — закрыть.
// kind: 'draw' | 'rooms' | 'furniture' | 'stairs' | 'props' | 'views' | 'sheets' | 'more'.
export function toggleSheet(kind) {
  // «Рисовать» — второй ряд инструментов; «Каталог» в «Плане» — второй ряд
  // каталога. Открыт один из двух.
  if (kind === 'draw' || (kind === 'rooms' && state.modeName === 'plan')) {
    const cls = kind === 'draw' ? DRAW : CAT;
    const open = !has(cls) || has(LIB);
    document.body.classList.remove(DRAW, CAT);
    if (open) document.body.classList.add(cls);
    closeAll();
    syncMobileBar();
    return;
  }
  document.body.classList.remove(DRAW);
  if (kind !== 'furniture' && kind !== 'stairs') document.body.classList.remove(CAT);
  let already;
  if (PANEL_TAB[kind]) already = has(PROPS) && (kind === 'sheets' ? viewsTab() : navTab() === PANEL_TAB[kind]);
  else if (kind === 'more') already = has(MORE);
  else if (kind === 'stairs') already = has(STAIRS);
  else already = libraryKindActive(kind);
  const tall = has(TALL);
  closeAll();
  if (!already) {
    if (PANEL_TAB[kind]) {
      document.body.classList.add(PROPS); // сначала лист: карточка уже скрыта и не вернёт вкладку «Свойства»
      setPropsTab(PANEL_TAB[kind]);
      el('propsPanel').scrollTop = 0;
    } else if (kind === 'more') {
      document.body.classList.add(MORE);
    } else if (kind === 'stairs') {
      document.body.classList.add(STAIRS);
    } else {
      if (state.modeName === 'plan') {
        const t = state.tool;
        if (kind === 'furniture' && t && (t.kind !== 'place-furniture' || t.itemKind === 'stairs') && !finishWallChain()) cancelTool();
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
  closeMobileToolFlyout();
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
  const context = toolContext();
  const drawing = context === 'drawing';
  const catalog = !drawing && context !== 'model' && context !== 'site';
  if (!catalog) document.body.classList.remove(CAT);
  if (drawing) document.body.classList.remove(DRAW);
  btn('draw').hidden = drawing;
  const lib = btn('rooms');
  if (lib) {
    const label = lib.querySelector('.mb-label') || lib;
    const text = state.modeName === 'landscape' ? 'Ландшафт' : 'Каталог';
    if (label.textContent !== text) label.textContent = text;
    // «Участок»: инструменты — в «Рисовать», каталога нет.
    lib.hidden = !catalog;
    lib.classList.toggle('active', has(LIB));
  }
  const props = has(PROPS);
  btn('draw')?.classList.toggle('active', has(DRAW));
  btn('props')?.classList.toggle('active', props && !viewsTab());
  btn('sheets')?.classList.toggle('active', props && viewsTab());
  btn('props')?.classList.toggle('dot', Boolean(state.selection)); // есть что смотреть
  if (lib && state.modeName === 'plan') lib.classList.toggle('active', has(CAT));
  syncCatRow(state.modeName === 'plan');
  syncDrawRow();
  syncGripButtons();
  for (const b of bar.querySelectorAll('[data-sheet]')) b.setAttribute('aria-pressed', String(b.classList.contains('active')));
  el('moreBtn')?.setAttribute('aria-expanded', String(has(MORE)));
  // Инструмент включён, а «Готово» в рядах не видно — своя кнопка на плане.
  const done = el('toolDone');
  if (done) done.hidden = !(isPhone() && state.tool && !has(DRAW) && !has(CAT) && !anySheet());
  syncSheetHead();
  syncMobileCard();
}

// В шапке листов можно переключиться на дерево видов. Пока открыт этот лист,
// заголовок и пояснение вкладки скрыты (data-tab у панели, styles.css).
function syncSheetHead() {
  const head = el('mobileSheetHead');
  const panel = el('propsPanel');
  if (!head || !panel) return;
  head.hidden = !viewsTab();
  if (panel.dataset.tab !== state.propsTab) panel.dataset.tab = state.propsTab;
  syncInspectorTitle();
  for (const b of head.querySelectorAll('[data-tab]')) {
    const on = b.dataset.tab === state.propsTab;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', String(on));
  }
}

function syncInspectorTitle() {
  const title = el('mobilePropsTitle');
  if (!title || !isPhone() || !has(PROPS) || viewsTab()) return;
  const body = el('propsBody');
  const source = body.querySelector('h2');
  const level = body.querySelector('#levelSection[open]');
  let label = body.querySelector('#roomName')?.value || source?.textContent.trim() || 'Свойства';
  if (source?.id === 'viewPropsTitle') {
    const name = label.replace(/^Вид:\s*/, '');
    label = state.modeName === 'plan' && body.querySelector('#levelName')?.value === name
      ? `План · ${name}` : `Вид · ${name}`;
    if (level) {
      const bounds = level.getBoundingClientRect();
      const gripBottom = title.parentElement.getBoundingClientRect().bottom;
      if (level.contains(document.activeElement) || (bounds.top <= gripBottom + 12 && bounds.bottom > gripBottom)) {
        label = `Свойства этажа · ${body.querySelector('#levelName').value}`;
      }
    }
  }
  if (title.textContent !== label) title.textContent = label;
}

function bindSheetHead() {
  const panel = el('propsPanel');
  panel.querySelector('.sheet-grip').prepend(el('mobilePropsTitle'));
  panel.addEventListener('scroll', syncInspectorTitle, { passive: true });
  panel.addEventListener('focusin', syncInspectorTitle);
  panel.addEventListener('toggle', syncInspectorTitle, true);
  el('mobileSheetHead')?.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-tab]')?.dataset.tab;
    if (tab) {
      setPropsTab(tab);
      syncMobileBar();
    }
  });
}

// Те же переключатели и кнопка аналитики обслуживают обе компоновки.
function placeMobileControls() {
  const bar = el('snapBar');
  const program = el('projectHomeProgram');
  if (isPhone()) {
    el('mobileSnapRow').append(bar);
    el('undoBtn').before(program);
  } else {
    el('scaleInfo').before(bar);
    el('projectRouteSteps').before(program);
  }
}

function bindMobileSnaps() {
  const controls = el('mobileSnapControls');
  const button = el('mobileSnapBtn');
  const panel = el('mobileSnapRow');
  const setOpen = (open) => {
    panel.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
  };
  button.addEventListener('click', (event) => {
    setOpen(panel.hidden);
    if (!panel.hidden && event.detail === 0) panel.querySelector('button')?.focus();
  });
  for (const type of ['pointerdown', 'focusin']) {
    document.addEventListener(type, (event) => {
      if (!panel.hidden && !controls.contains(event.target)) setOpen(false);
    });
  }
  document.addEventListener('keydown', (event) => {
    if (panel.hidden || event.key !== 'Escape') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    setOpen(false);
    button.focus({ preventScroll: true });
  }, true);
  document.addEventListener('kepler:view', () => setOpen(false));
  globalThis.matchMedia?.('(max-width: 640px)').addEventListener?.('change', () => {
    setOpen(false);
    placeMobileControls();
    syncMobileBar();
  });
}

// Второй ряд «Каталога»: значки берутся у кнопок колонки инструментов (их
// обработчики — ui/toolbar.js, ui/toolstrip.js).
const CAT_ITEMS = [
  { id: 'room', label: 'Комнаты', src: 'boundRoomBtn' },
  { id: 'furniture', label: 'Мебель', src: 'furnitureToolBtn' },
  { id: 'stairs', label: 'Лестницы', src: 'stairsToolBtn' },
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
  row.appendChild(doneButton());
  row.addEventListener('click', (e) => {
    if (e.target.closest('[data-done]')) { finishTool(); return; }
    const b = e.target.closest('[data-cat]');
    if (b) pickCatalog(b.dataset.cat);
  });
}

// Кнопка ряда: значок и подпись.
function rowButton(icon, label) {
  const b = document.createElement('button');
  b.type = 'button';
  b.setAttribute('aria-label', label);
  const svg = icon?.cloneNode(true);
  if (svg) { svg.setAttribute('width', '22'); svg.setAttribute('height', '22'); b.appendChild(svg); }
  const span = document.createElement('span');
  span.className = 'mb-label';
  span.textContent = label;
  b.appendChild(span);
  return b;
}

function doneButton() {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'row-done';
  b.dataset.done = '1';
  b.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg><span class="mb-label">Готово</span>';
  return b;
}

// Инструменты ландшафта, которые заканчиваются кнопкой в «Свойствах»
// (разрез, массив, контур): «Готово» нажимает её.
const FINISH_TOOLS = ['ls-section', 'ls-array', 'draw-landscape'];
const FINISH_BUTTONS = '#lsSecFinish, #lsArApply, #lsDrawFinish';
function toolFinishButton() {
  if (!FINISH_TOOLS.includes(state.tool?.kind)) return null;
  if (state.propsTab !== 'props') setPropsTab('props'); // кнопка — в «Свойствах» инструмента
  const b = el('propsBody')?.querySelector(FINISH_BUTTONS);
  return b && !b.disabled ? b : null;
}

// «Готово» в рядах и на плане: закончить ломаную (как «✓ Готово» на плане),
// разрез, массив или контур ландшафта, цепочку стен; иначе — выйти из
// инструмента. Ряд убирается.
function finishTool() {
  closeMobileToolFlyout();
  const draft = el('draftDone');
  if (draft && !draft.hidden) { draft.click(); return; }
  const tool = state.tool;
  toolFinishButton()?.click();
  if (state.tool && state.tool === tool && !finishWallChain()) cancelTool(); // закончить не вышло — выйти
  document.body.classList.remove(DRAW, CAT);
  closeAll();
  syncMobileBar();
  renderToolstrip();
}

// Второй ряд «Рисовать»: зеркала кнопок колонки инструментов текущего режима.
// На плане родительская иконка раскрывает связанные инструменты в общий popup,
// который находится вне прокручиваемого ряда и потому не обрезается overflow.
const PLAN_DRAW = [
  { type: 'tool', id: 'wallToolBtn' },
  { type: 'family', id: 'openings' },
  { type: 'tool', id: 'roofToolBtn' },
  { type: 'family', id: 'mass' },
  { type: 'family', id: 'docs' },
];
const drawSource = new WeakMap(); // кнопка ряда → кнопка колонки
let drawKey = '';
let openMobileFamily = '';
let mobileFamilyTrigger = null;

const toolFamily = (id) => getPlanToolFamilies().find((family) => family.id === id);
const familySources = (family) => (family?.childIds || []).filter((id) => toolContext() !== 'model' || availableModelTool(id)).map((id) => el(id)).filter(Boolean);

function familyActive(family) {
  const sources = familySources(family);
  // «Размеры» — постоянная настройка, поэтому сами по себе не подсвечивают
  // родителя «Документация». Состояние остаётся видно на дочерней кнопке.
  const relevant = family?.activeChildIds
    ? sources.filter((source) => family.activeChildIds.includes(source.id))
    : sources;
  return relevant.some((source) => source.classList.contains('active') || source.getAttribute('aria-pressed') === 'true');
}

function closeMobileToolFlyout({ restoreFocus = false } = {}) {
  const flyout = el('mobileToolFlyout');
  if (!flyout) return;
  const trigger = mobileFamilyTrigger;
  flyout.hidden = true;
  flyout.replaceChildren();
  flyout.removeAttribute('data-family');
  openMobileFamily = '';
  mobileFamilyTrigger = null;
  el('mobileDraw')?.querySelectorAll('[data-draw-family]').forEach((button) => button.setAttribute('aria-expanded', 'false'));
  if (restoreFocus && trigger?.isConnected) trigger.focus();
}

function positionMobileToolFlyout(trigger) {
  const flyout = el('mobileToolFlyout');
  if (!flyout || flyout.hidden || !trigger?.isConnected) return;
  const gap = 8;
  const edge = 8;
  const triggerRect = trigger.getBoundingClientRect();
  const flyoutRect = flyout.getBoundingClientRect();
  const viewport = window.visualViewport;
  const viewportLeft = viewport?.offsetLeft || 0;
  const viewportTop = viewport?.offsetTop || 0;
  const viewportWidth = viewport?.width || window.innerWidth;
  const viewportHeight = viewport?.height || window.innerHeight;
  const left = Math.max(viewportLeft + edge, Math.min(
    triggerRect.left + (triggerRect.width - flyoutRect.width) / 2,
    viewportLeft + viewportWidth - flyoutRect.width - edge,
  ));
  const preferredTop = triggerRect.top - flyoutRect.height - gap;
  const top = preferredTop >= viewportTop + edge
    ? preferredTop
    : Math.min(viewportTop + viewportHeight - flyoutRect.height - edge, triggerRect.bottom + gap);
  flyout.style.left = `${Math.round(left)}px`;
  flyout.style.top = `${Math.round(Math.max(viewportTop + edge, top))}px`;
}

function openMobileToolFamily(id, trigger, { focusFirst = false } = {}) {
  const flyout = el('mobileToolFlyout');
  const family = toolFamily(id);
  if (!flyout || !family || !trigger) return;
  if (!flyout.hidden && openMobileFamily === id) {
    closeMobileToolFlyout();
    return;
  }
  closeMobileToolFlyout();
  openMobileFamily = id;
  mobileFamilyTrigger = trigger;
  flyout.dataset.family = id;
  flyout.setAttribute('aria-label', family.label || trigger.getAttribute('aria-label') || 'Варианты инструмента');
  for (const source of familySources(family)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'mobile-tool-child';
    button.dataset.toolChild = source.id;
    button.setAttribute('aria-label', source.getAttribute('aria-label') || source.querySelector('.tb-label')?.textContent.trim() || 'Инструмент');
    const icon = source.querySelector('svg')?.cloneNode(true);
    if (icon) {
      icon.setAttribute('width', '22');
      icon.setAttribute('height', '22');
      button.appendChild(icon);
    }
    const on = source.classList.contains('active') || source.getAttribute('aria-pressed') === 'true';
    button.classList.toggle('active', on);
    button.setAttribute('aria-pressed', String(on));
    button.disabled = Boolean(source.disabled);
    flyout.appendChild(button);
  }
  flyout.hidden = false;
  el('mobileDraw')?.querySelectorAll('[data-draw-family]').forEach((button) => {
    button.setAttribute('aria-expanded', String(button === trigger));
  });
  positionMobileToolFlyout(trigger);
  if (focusFirst) flyout.querySelector('button:not(:disabled)')?.focus();
}

function syncMobileToolFlyout() {
  const flyout = el('mobileToolFlyout');
  const family = toolFamily(openMobileFamily);
  if (!flyout || flyout.hidden || !family || !mobileFamilyTrigger?.isConnected || !has(DRAW)) {
    if (flyout && !flyout.hidden) closeMobileToolFlyout();
    return;
  }
  for (const button of flyout.querySelectorAll('[data-tool-child]')) {
    const source = el(button.dataset.toolChild);
    const on = Boolean(source?.classList.contains('active') || source?.getAttribute('aria-pressed') === 'true');
    button.classList.toggle('active', on);
    button.setAttribute('aria-pressed', String(on));
    button.disabled = Boolean(source?.disabled);
  }
  positionMobileToolFlyout(mobileFamilyTrigger);
}

function drawSources() {
  if (state.modeName === 'site') return [...(el('siteTools')?.querySelectorAll('.tb-btn') || [])].map((source) => ({ type: 'tool', source }));
  if (state.modeName === 'landscape') return [...(el('landscapeTools')?.querySelectorAll('.tb-btn') || [])].map((source) => ({ type: 'tool', source }));
  const model = toolContext() === 'model';
  const entries = PLAN_DRAW.filter((entry) => !model || availableModelTool(entry.type === 'family' ? toolFamily(entry.id)?.parentId : entry.id));
  return entries.map((entry) => entry.type === 'family'
    ? { ...entry, family: toolFamily(entry.id) }
    : { ...entry, source: el(entry.id) })
    .filter((entry) => entry.type === 'family' ? Boolean(entry.family) : Boolean(entry.source));
}
const sourceId = (b) => b.id || b.dataset.siteTool || b.dataset.lsTool || '';
const drawEntryId = (entry) => entry.type === 'family' ? `family:${entry.id}` : sourceId(entry.source);

function syncDrawRow() {
  const row = el('mobileDraw');
  if (!row) return;
  row.hidden = !has(DRAW) || has(LIB);
  if (row.hidden) { closeMobileToolFlyout(); return; }
  const src = drawSources();
  const key = `${state.modeName}:${src.map(drawEntryId).join(',')}`;
  if (key !== drawKey) {
    closeMobileToolFlyout();
    drawKey = key;
    row.replaceChildren();
    for (const entry of src) {
      const source = entry.type === 'family' ? el(entry.family.parentId) : entry.source;
      const label = entry.type === 'family'
        ? (entry.family.label || source?.getAttribute('aria-label') || '')
        : (source?.querySelector('.tb-label')?.textContent.trim() || source?.getAttribute('aria-label') || '');
      const b = rowButton(source?.querySelector('svg'), label);
      if (entry.type === 'family') {
        b.dataset.drawFamily = entry.id;
        b.setAttribute('aria-controls', 'mobileToolFlyout');
        b.setAttribute('aria-expanded', 'false');
      } else {
        b.dataset.draw = sourceId(source);
        drawSource.set(b, source);
      }
      row.appendChild(b);
    }
    row.appendChild(doneButton());
  }
  for (const b of row.querySelectorAll('[data-draw]')) {
    const s = drawSource.get(b);
    const on = Boolean(s?.classList.contains('active'));
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
    b.disabled = Boolean(s?.disabled);
  }
  for (const b of row.querySelectorAll('[data-draw-family]')) {
    const family = toolFamily(b.dataset.drawFamily);
    const sources = familySources(family);
    const on = familyActive(family);
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
    b.disabled = !sources.length || sources.every((source) => source.disabled);
    b.setAttribute('aria-expanded', String(!el('mobileToolFlyout')?.hidden && openMobileFamily === family?.id));
  }
  syncMobileToolFlyout();
}

function bindDrawRow() {
  el('mobileDraw')?.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if (b.dataset.done) { finishTool(); return; }
    if (b.dataset.drawFamily) {
      openMobileToolFamily(b.dataset.drawFamily, b, { focusFirst: e.detail === 0 });
      return;
    }
    closeMobileToolFlyout();
    drawSource.get(b)?.click(); // обработчик кнопки колонки (ui/toolbar.js, ui/toolstrip.js)
    syncMobileBar();
  });
}

function bindMobileToolFlyout() {
  const flyout = el('mobileToolFlyout');
  if (!flyout) return;
  flyout.addEventListener('click', (e) => {
    const button = e.target.closest('[data-tool-child]');
    if (!button || button.disabled) return;
    const trigger = mobileFamilyTrigger;
    const source = el(button.dataset.toolChild);
    source?.click();
    if (['doorToolBtn', 'windowToolBtn'].includes(button.dataset.toolChild)
      && state.tool?.kind === 'place-opening') openLibrarySheet();
    closeMobileToolFlyout();
    if (e.detail === 0 && trigger?.isConnected) trigger.focus();
    syncMobileBar();
  });
  flyout.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape'].includes(e.key)) return;
    e.preventDefault();
    if (e.key === 'Escape') { closeMobileToolFlyout({ restoreFocus: true }); return; }
    const buttons = [...flyout.querySelectorAll('button:not(:disabled)')];
    if (!buttons.length) return;
    const current = Math.max(0, buttons.indexOf(document.activeElement));
    const next = e.key === 'Home' ? 0
      : e.key === 'End' ? buttons.length - 1
        : (current + (e.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next].focus();
  });
  document.addEventListener('pointerdown', (e) => {
    if (flyout.hidden || flyout.contains(e.target) || mobileFamilyTrigger?.contains(e.target)) return;
    closeMobileToolFlyout();
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !flyout.hidden) closeMobileToolFlyout({ restoreFocus: true });
  });
  el('mobileDraw')?.addEventListener('scroll', () => closeMobileToolFlyout(), { passive: true });
  window.addEventListener('resize', () => closeMobileToolFlyout());
  window.addEventListener('orientationchange', () => closeMobileToolFlyout());
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
  row.hidden = !has(CAT) || has(LIB);
  for (const b of row.querySelectorAll('[data-cat]')) {
    const on = catActive(b.dataset.cat);
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  }
}

// Лист «Лестница»: готовый стиль или отдельная форма, затем касание плана.
const STAIR_ICONS = {
  straight: '<rect x="8" y="2.5" width="8" height="19" rx="1"/><path d="M8 6.5h8M8 10.5h8M8 14.5h8M8 18.5h8"/>',
  l: '<path d="M4 21.5V12h8V2.5h8v19z"/><path d="M4 16.5h8M12 7h8M12 12h8M12 16.5h8"/>',
  u: '<path d="M3 21.5V2.5h18v19h-7V9h-4v12.5z"/><path d="M3 15h7M3 9h7M14 15h7M14 9h7"/>',
  u3: '<path d="M3 21.5V2.5h18v19h-6V8.5H9v13z"/><path d="M3 15h6M15 15h6M9 2.5v6M15 2.5v6"/>',
};
function buildStairsSheet() {
  const box = el('mobileStairs');
  if (!box || box.querySelector('.ms-grid')) return;
  const presetsTitle = document.createElement('h3');
  presetsTitle.className = 'mm-title';
  presetsTitle.textContent = 'Готовые лестницы';
  const presets = document.createElement('div');
  presets.className = 'ms-presets';
  for (const group of [
    { id: 'interior', title: 'Для интерьера' },
    { id: 'exterior', title: 'Для улицы' },
  ]) {
    const section = document.createElement('section');
    const heading = document.createElement('h4');
    heading.textContent = group.title;
    const cards = document.createElement('div');
    cards.className = 'mm-grid ms-style-grid';
    for (const preset of STAIR_STYLE_PRESETS.filter((entry) => entry.environment === group.id)) {
      cards.appendChild(stairPresetCard(preset));
    }
    section.append(heading, cards);
    presets.appendChild(section);
  }
  const h = document.createElement('h3');
  h.className = 'mm-title';
  h.textContent = 'По форме';
  const grid = document.createElement('div');
  grid.className = 'mm-grid ms-grid';
  grid.innerHTML = STAIR_SHAPES.map((sh) => `<button type="button" data-stair="${sh.id}">
    <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true">${STAIR_ICONS[sh.id] || ''}</svg>${sh.title}</button>`).join('');
  box.append(presetsTitle, presets, h, grid);
  presets.addEventListener('click', (e) => {
    const button = e.target.closest('[data-stair-preset]');
    if (!button) return;
    e.stopPropagation();
    if (state.tool?.kind === 'wall') finishWallChain();
    const preset = STAIR_STYLE_PRESETS.find((entry) => entry.id === button.dataset.stairPreset);
    if (!preset) return;
    startPlaceFurniture('stairs', preset.title, { stairPreset: preset.id, stairShape: preset.shape });
    closeAll();
    renderToolstrip();
  });
  grid.addEventListener('click', (e) => {
    const b = e.target.closest('[data-stair]');
    if (!b) return;
    e.stopPropagation();
    if (state.tool?.kind === 'wall') finishWallChain();
    const sh = STAIR_SHAPES.find((x) => x.id === b.dataset.stair);
    startPlaceFurniture('stairs', `Лестница: ${sh?.title || ''}`, { stairPreset: 'interior-wood', stairShape: b.dataset.stair });
    closeAll();
    renderToolstrip();
  });
}

function syncGripButtons() {
  const expanded = has(TALL);
  for (const button of document.querySelectorAll('.sheet-resize')) {
    button.setAttribute('aria-expanded', String(expanded));
    button.setAttribute('aria-label', expanded ? 'Свернуть панель' : 'Развернуть панель');
  }
}

// Лист меняет высоту только от ручки. Список карточек можно свободно прокручивать.
function attachGrip(panel, onClose) {
  if (!panel || panel.querySelector(':scope > .sheet-grip')) return;
  const grip = document.createElement('div');
  grip.className = 'sheet-grip';
  grip.innerHTML = '<button type="button" class="sheet-resize" aria-label="Развернуть панель" aria-expanded="false"><span class="sheet-handle" aria-hidden="true"></span></button><button type="button" class="sheet-close" aria-label="Закрыть">✕</button>';
  panel.prepend(grip);
  const resize = grip.querySelector('.sheet-resize');
  grip.querySelector('.sheet-close').addEventListener('click', (e) => { e.stopPropagation(); onClose(); });
  let drag = null;
  let dragged = false;
  resize.addEventListener('click', (e) => {
    if (e.detail && dragged) return;
    document.body.classList.toggle(TALL);
    syncGripButtons();
  });
  resize.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary || e.button !== 0) return;
    const host = panel.parentElement.getBoundingClientRect();
    drag = { id: e.pointerId, y: e.clientY, h: panel.getBoundingClientRect().height, max: host.height };
    dragged = false;
    resize.setPointerCapture(e.pointerId);
  });
  resize.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = e.clientY - drag.y;
    if (!dragged && Math.abs(dy) < 5) return;
    dragged = true;
    panel.style.transition = 'none';
    panel.style.height = `${Math.max(80, Math.min(drag.max, drag.h - dy))}px`;
  });
  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = e.clientY - drag.y;
    const h = drag.h - dy;
    drag = null;
    panel.style.transition = '';
    panel.style.height = '';
    if (e.type !== 'pointerup' || !dragged) return;
    if (dy > 64 && (!has(TALL) || h < panel.parentElement.clientHeight * 0.3)) { onClose(); return; }
    if (Math.abs(dy) > 32) document.body.classList.toggle(TALL, dy < 0);
    syncGripButtons();
  };
  resize.addEventListener('pointerup', end);
  resize.addEventListener('pointercancel', end);
  resize.addEventListener('lostpointercapture', end);
}

// Пункты листа «Ещё» («⋯» в шапке) — кнопки шапки, скрытые на телефоне.
function bindMore() {
  const more = el('mobileMore');
  if (!more) return;
  const click = (id) => el(id)?.click();
  const ACTIONS = {
    projects: () => click('projectsBtn'),
    download: () => click('saveBtn'),
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
  // Только поле ввода с клавиатурой, только на телефоне и только если его
  // закрыло: иначе галочки и кнопки после касания уезжали к центру — панель «прыгала».
  const TYPING = 'input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="button"]):not([type="color"]):not([type="file"]), textarea';
  document.addEventListener('focusin', (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement) || !isPhone() || !t.matches(TYPING) || !t.closest('.props, .library')) return;
    setTimeout(() => {
      if (document.activeElement !== t) return;
      const r = t.getBoundingClientRect();
      if (r.top >= 8 && r.bottom <= vv.height - 8) return; // и так видно
      try { t.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch { /* старый браузер */ }
    }, 320);
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
  bindDrawRow();
  bindMobileToolFlyout();
  bindSheetHead();
  buildStairsSheet();
  attachGrip(el('mobileStairs'), () => closeSheets());
  placeMobileControls();
  bindMobileSnaps();
  bindMobileCard({
    isPhone,
    sheetOpen: () => anySheet() || el('issuesBtn')?.getAttribute('aria-expanded') === 'true',
    openProps: () => toggleSheet('props'),
    ensurePropsTab: () => { if (state.propsTab !== 'props') setPropsTab('props'); },
  });
  el('fitFab')?.addEventListener('click', () => el('fitBtn')?.click());
  el('toolDone')?.addEventListener('click', () => finishTool());
  // Подсказки без клавиш: «Готово» заканчивает цепочку стен и контур, у остальных — выход.
  bindTouchHints({
    isPhone,
    context: () => ({ tool: Boolean(state.tool), finish: state.tool?.kind === 'wall' || state.tool?.kind === 'slab-opening' || Boolean(state.draft) || FINISH_TOOLS.includes(state.tool?.kind) }),
  });
  // Перерисовались «Свойства» или панель действий — обновить карточку и шапку листа.
  let queued = false;
  const observer = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; syncMobileBar(); });
  });
  if (el('propsBody')) observer.observe(el('propsBody'), { childList: true });
  if (el('selectionToolbar')) observer.observe(el('selectionToolbar'), { childList: true, attributes: true, attributeFilter: ['hidden'] });
  bindMore();
  // 3D, смена режима или вида (дерево видов, клавиши) — подсветка навигации.
  document.addEventListener('kepler:view', () => syncMobileBar());
  el('view3dBtn')?.addEventListener('click', () => setTimeout(syncMobileBar, 0));
}

// Вкладки открытых чертежей и единый список видов. Камера и редактирование
// принадлежат соответствующему виду; навигация меняет только активный вид.
import { sortedLevels } from '../core/model.js';
import { ROOF_PLAN_VIEW, facadeViews, sectionViews } from '../core/views.js';
import { activeViewId, openView } from './props-views.js';
import { landscapeSections } from './landscape-section.js';
import { sheetKey, sheetList, sheetNumber, sheetTitle } from './sheet.js';
import { openSheet } from './sheet-view.js';
import { state } from './state.js';
import { addLevel } from './levels.js';
import { isPhone, toggleSheet } from './mobile.js';
import { selectObject } from './tools.js';
import { escapeHtml } from './dom.js';
import { bindViewMenu, viewIcon } from './workspace-view-menu.js';

function modelViews() {
  const project = state.project;
  return [
    ['plans', sortedLevels(project).map((l) => [`plan:${l.id}`, l.name, 'plan']).concat([[ROOF_PLAN_VIEW, 'План крыши', 'roof']])],
    ['model', [['3d', '3D', 'model'], ['site', 'Участок', 'site'], ['landscape', 'Ландшафт', 'landscape']]],
    ['sections', [...sectionViews(project).map((v) => [v.id, v.name, 'section']),
      ...landscapeSections().map((s) => [`section:${s.id}`, `Разрез ${s.name}–${s.name}`, 'section'])]],
    ['facades', facadeViews(project).map((v) => [v.id, v.name, 'facade'])],
  ];
}

function sheets() {
  return sheetList(state.project).map((s, i) => [`sheet:${sheetKey(s)}`, `Л${sheetNumber(s, i)} · ${sheetTitle(state.project, s)}`, 'sheet']);
}

function activate(id) {
  if (id.startsWith('sheet:')) openSheet(id.slice('sheet:'.length));
  else openView(id);
}

export function bindWorkspaceViews() {
  const nav = document.getElementById('workspaceViews');
  if (!nav) return;
  const plan = document.getElementById('modePlanBtn');
  const defaults = new Map([['3d', 'view3dBtn'], ['site', 'modeSiteBtn'], ['landscape', 'landscapeBtn']]
    .map(([id, button]) => [id, document.getElementById(button)]));
  const tabs = nav.querySelector('.wv-tabs');
  const closeTab = nav.querySelector('.wv-close');
  const extra = new Map();
  let firstPlan = null;
  let pending = false;
  let projectId = state.pid;
  let recent = [];
  let order = [];
  const closed = new Set();
  let draggedKey = null;

  function menuData() {
    const groups = [...modelViews(), ['sheets', sheets()]];
    const level = state.project.levels.find((item) => item.id === state.project.activeLevel);
    const actions = isPhone() ? [['add-level', 'Добавить этаж', 'plus'], ['level-properties', `Свойства «${level.name}»`, 'props']] : [];
    return { groups, active: state.sheetOpen ? `sheet:${state.sheetOpen}` : activeViewId(), actions };
  }
  const menu = bindViewMenu(nav, menuData, (target) => {
    if (target === 'add-level' || target === 'level-properties') {
      openView(`plan:${state.project.activeLevel}`);
      if (target === 'add-level') { addLevel(); return; }
      selectObject(null);
      toggleSheet('props');
      const section = document.getElementById('levelSection');
      if (section) {
        section.open = true;
        section.querySelector('summary').focus({ preventScroll: true });
        section.scrollIntoView({ block: 'start' });
      }
    } else if (target) {
      closed.delete(target);
      if (!order.includes(target)) order.push(target);
      activate(target);
    }
  });

  function render() {
    pending = false;
    if (!state.project) return;
    const groups = modelViews();
    if (state.pid !== projectId) {
      for (const btn of extra.values()) btn.remove();
      extra.clear();
      recent = [];
      order = [];
      closed.clear();
      firstPlan = null;
      projectId = state.pid;
    }
    const records = new Map(groups.flatMap(([, list]) => list).map((item) => [item[0], item]));
    const active = state.sheetOpen ? `sheet:${state.sheetOpen}` : activeViewId();
    if (state.sheetOpen || [...extra.keys()].some((key) => key.startsWith('sheet:'))) {
      for (const item of sheets()) records.set(item[0], item);
    }
    if (!records.has(firstPlan)) firstPlan = `plan:${sortedLevels(state.project)[0].id}`;
    const buttons = new Map([[firstPlan, plan], ...defaults]);
    if (!order.length) order = [...buttons.keys()].filter((key) => records.has(key));
    closed.delete(active);
    if (!order.includes(active)) order.push(active);
    if (records.has(active) && !buttons.has(active) && !extra.has(active)) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('role', 'tab');
      btn.addEventListener('click', () => activate(active));
      extra.set(active, btn);
    }
    for (const [key, btn] of extra) {
      if (records.has(key) && !buttons.has(key)) buttons.set(key, btn);
      else { btn.remove(); extra.delete(key); }
    }
    for (const [key, btn] of buttons) {
      const entry = records.get(key);
      if (!entry || !btn) continue;
      const [, name, kind] = entry;
      if (btn.dataset.workspaceView !== key || btn.dataset.title !== name) {
        btn.setAttribute('role', 'tab');
        btn.dataset.workspaceView = key;
        btn.dataset.title = name;
        btn.innerHTML = viewIcon(kind) + '<span>' + escapeHtml(name) + '</span><i class="wv-tab-x" aria-hidden="true">×</i>';
        btn.title = name;
        btn.setAttribute('aria-label', name);
        btn.draggable = true;
        btn.removeAttribute('aria-pressed');
      }
      if (closed.has(key) && key !== active) {
        btn.remove();
        continue;
      }
      if (!order.includes(key)) order.push(key);
      btn.classList.toggle('active', key === active);
      btn.setAttribute('aria-selected', String(key === active));
      btn.tabIndex = key === active ? 0 : -1;
    }
    order = order.filter((key) => records.has(key) && buttons.has(key));
    for (const key of order) {
      const btn = buttons.get(key);
      if (btn && !closed.has(key)) tabs.append(btn);
    }
    const current = buttons.get(active);
    recent = recent.filter((id) => id !== active && buttons.has(id));
    if (current) recent.push(active);
    closeTab.hidden = true;
    nav.hidden = false;
    if (current && (current.offsetLeft < tabs.scrollLeft || current.offsetLeft + current.offsetWidth > tabs.scrollLeft + tabs.clientWidth)) {
      tabs.scrollLeft = current.offsetLeft - tabs.clientWidth / 2 + current.offsetWidth / 2;
    }
    menu.refresh();
  }
  function schedule() {
    if (!pending) { pending = true; requestAnimationFrame(render); }
  }
  function closeView(key = recent.at(-1)) {
    if (!key) return;
    const visible = order.filter((id) => !closed.has(id));
    if (visible.length <= 1) return;
    const wasActive = key === (state.sheetOpen ? `sheet:${state.sheetOpen}` : activeViewId());
    closed.add(key);
    recent = recent.filter((id) => id !== key);
    if (wasActive) {
      const index = order.indexOf(key);
      const fallback = recent.at(-1) || [...order.slice(0, index).reverse(), ...order.slice(index + 1)]
        .find((id) => !closed.has(id));
      if (fallback) activate(fallback);
    }
    schedule();
    requestAnimationFrame(() => tabs.querySelector('[aria-selected="true"]')?.focus({ preventScroll: true }));
  }
  closeTab.addEventListener('click', () => closeView());
  tabs.addEventListener('click', (event) => {
    const close = event.target.closest('.wv-tab-x');
    if (!close) return;
    event.preventDefault();
    event.stopPropagation();
    closeView(close.closest('[data-workspace-view]')?.dataset.workspaceView);
  }, true);
  tabs.addEventListener('dragstart', (event) => {
    const tab = event.target.closest('[data-workspace-view]');
    if (!tab) return;
    draggedKey = tab.dataset.workspaceView;
    tab.classList.add('dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', draggedKey);
  });
  tabs.addEventListener('dragover', (event) => {
    if (!draggedKey) return;
    const over = event.target.closest('[data-workspace-view]');
    if (!over || over.dataset.workspaceView === draggedKey) return;
    event.preventDefault();
    const from = order.indexOf(draggedKey);
    let to = order.indexOf(over.dataset.workspaceView);
    if (from < 0 || to < 0) return;
    order.splice(from, 1);
    if (from < to) to -= 1;
    if (event.clientX > over.getBoundingClientRect().left + over.offsetWidth / 2) to += 1;
    order.splice(to, 0, draggedKey);
    const dragged = tabs.querySelector(`[data-workspace-view="${CSS.escape(draggedKey)}"]`);
    if (dragged) tabs.insertBefore(dragged, event.clientX > over.getBoundingClientRect().left + over.offsetWidth / 2 ? over.nextSibling : over);
  });
  tabs.addEventListener('dragend', (event) => {
    event.target.closest('[data-workspace-view]')?.classList.remove('dragging');
    draggedKey = null;
  });
  tabs.addEventListener('keydown', (event) => {
    const btns = [...tabs.children];
    const i = btns.indexOf(event.target);
    if (i < 0) return;
    if (event.key === 'Delete') {
      event.preventDefault();
      event.stopPropagation();
      closeView(event.target.dataset.workspaceView);
      return;
    }
    const next = { ArrowLeft: (i + btns.length - 1) % btns.length, ArrowRight: (i + 1) % btns.length, Home: 0, End: btns.length - 1 }[event.key];
    if (next == null) return;
    event.preventDefault();
    event.stopPropagation();
    const target = btns[next];
    target.click();
    target.focus({ preventScroll: true });
    requestAnimationFrame(() => target.isConnected && target.focus({ preventScroll: true }));
  });
  document.addEventListener('kepler:view', schedule);
  document.addEventListener('kepler:project-change', schedule);
  document.addEventListener('kepler:project-replaced', () => {
    menu.close();
    for (const btn of extra.values()) btn.remove();
    extra.clear();
    recent = [];
    order = [];
    closed.clear();
    firstPlan = null;
    schedule();
  });
  schedule();
}

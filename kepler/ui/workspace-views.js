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
    } else if (target) activate(target);
  });

  function render() {
    pending = false;
    if (!state.project) return;
    const groups = modelViews();
    if (state.pid !== projectId) {
      for (const btn of extra.values()) btn.remove();
      extra.clear();
      recent = [];
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
        btn.innerHTML = viewIcon(kind) + '<span>' + escapeHtml(name) + '</span>';
        btn.title = name;
        btn.setAttribute('aria-label', name);
        btn.removeAttribute('aria-pressed');
      }
      if (btn.parentElement !== tabs) tabs.append(btn);
      btn.classList.toggle('active', key === active);
      btn.setAttribute('aria-selected', String(key === active));
      btn.tabIndex = key === active ? 0 : -1;
    }
    const current = buttons.get(active);
    recent = recent.filter((id) => id !== active && buttons.has(id));
    if (current) recent.push(active);
    closeTab.hidden = !extra.has(active);
    if (!closeTab.hidden) {
      closeTab.title = `Закрыть вкладку «${current.dataset.title}»`;
      closeTab.setAttribute('aria-label', closeTab.title);
    }
    nav.hidden = false;
    if (current && (current.offsetLeft < tabs.scrollLeft || current.offsetLeft + current.offsetWidth > tabs.scrollLeft + tabs.clientWidth)) {
      tabs.scrollLeft = current.offsetLeft - tabs.clientWidth / 2 + current.offsetWidth / 2;
    }
    menu.refresh();
  }
  function schedule() {
    if (!pending) { pending = true; requestAnimationFrame(render); }
  }
  function closeCurrentTab() {
    const current = recent.at(-1);
    if (!extra.has(current)) return;
    extra.get(current).remove();
    extra.delete(current);
    recent.pop();
    activate(recent.at(-1) || firstPlan);
    schedule();
    requestAnimationFrame(() => tabs.querySelector('[aria-selected="true"]')?.focus({ preventScroll: true }));
  }
  closeTab.addEventListener('click', closeCurrentTab);
  tabs.addEventListener('keydown', (event) => {
    const btns = [...tabs.children];
    const i = btns.indexOf(event.target);
    if (i < 0) return;
    if (event.key === 'Delete' && !closeTab.hidden) {
      event.preventDefault();
      event.stopPropagation();
      closeCurrentTab();
      return;
    }
    const next = { ArrowLeft: (i + btns.length - 1) % btns.length, ArrowRight: (i + 1) % btns.length, Home: 0, End: btns.length - 1 }[event.key];
    if (next == null) return;
    event.preventDefault();
    event.stopPropagation();
    btns[next].focus();
    btns[next].click();
  });
  document.addEventListener('kepler:view', schedule);
  document.addEventListener('kepler:project-change', schedule);
  document.addEventListener('kepler:project-replaced', () => {
    menu.close();
    for (const btn of extra.values()) btn.remove();
    extra.clear();
    recent = [];
    firstPlan = null;
    schedule();
  });
  schedule();
}

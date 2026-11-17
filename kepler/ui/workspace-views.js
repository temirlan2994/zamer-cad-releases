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

const paths = {
  views: 'M3 4h7v7H3zM14 4h7v7h-7zM3 15h7v5H3zM14 15h7v5h-7z',
  plan: 'M3 4h18v16H3zM11 4v8H3m8-3h10m-6 0v6',
  model: 'm12 2 9 5v10l-9 5-9-5V7zM3 7l9 5 9-5m-9 5v10',
  site: 'm3 5 6-2 6 3 6-2v15l-6 2-6-3-6 2zm6-2v15m6-12v15',
  landscape: 'M7 21v-5m-4 0 4-7 4 7zm13 5v-8m-5 0 5-10 5 10z',
  section: 'M3 18h18M5 15V7l7-4 7 4v8M5 11h14',
  sheet: 'M5 2h10l4 4v16H5zM14 2v6h5M8 12h8m-8 4h5',
};
const icon = (kind) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[kind]}"/></svg>`;

function modelViews() {
  const project = state.project;
  return [
    ['Планы', sortedLevels(project).map((l) => [`plan:${l.id}`, l.name, 'plan']).concat([[ROOF_PLAN_VIEW, 'План крыши', 'plan']])],
    ['Модель и участок', [['3d', '3D', 'model'], ['site', 'Участок', 'site'], ['landscape', 'Ландшафт', 'landscape']]],
    ['Разрезы', [...sectionViews(project).map((v) => [v.id, v.name, 'section']),
      ...landscapeSections().map((s) => [`section:${s.id}`, `Разрез ${s.name}–${s.name}`, 'section'])]],
    ['Фасады', facadeViews(project).map((v) => [v.id, v.name, 'section'])],
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
  nav.innerHTML = `<label class="wv-catalog">${icon('views')}<span>Все виды</span><span aria-hidden="true">⌄</span>
    <select id="workspaceViewPicker" aria-label="Все виды проекта"></select></label>
    <div class="wv-tabs" role="tablist" aria-label="Виды на рабочем столе"></div>
    <button type="button" class="wv-close" aria-label="Закрыть вкладку" hidden>×</button>`;
  const tabs = nav.querySelector('.wv-tabs');
  const closeTab = nav.querySelector('.wv-close');
  const picker = nav.querySelector('select');
  const extra = new Map();
  let firstPlan = null;
  let pending = false;
  let catalogStamp = '';
  let projectId = state.pid;
  let recent = [];

  function populate() {
    if (!state.project) return;
    const groups = [...modelViews(), ['Листы', sheets()]];
    picker.replaceChildren(new Option('Открыть вид…', ''));
    for (const [name, entries] of groups) {
      if (!entries.length) continue;
      const g = document.createElement('optgroup');
      g.label = name;
      g.append(...entries.map(([id, title]) => new Option(title, id)));
      if (name === 'Планы' && isPhone()) {
        const level = state.project.levels.find((item) => item.id === state.project.activeLevel);
        g.append(new Option('＋ Добавить этаж', 'add-level'), new Option(`Свойства «${level.name}»`, 'level-properties'));
      }
      picker.append(g);
    }
    picker.value = state.sheetOpen ? `sheet:${state.sheetOpen}` : activeViewId();
  }
  matchMedia('(max-width: 640px)').addEventListener('change', populate);
  picker.addEventListener('focus', populate);
  picker.addEventListener('pointerdown', populate);
  picker.addEventListener('change', () => {
    const target = picker.value;
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
        btn.innerHTML = icon(kind) + '<span>' + escapeHtml(name) + '</span>';
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
    if (current && (current.offsetLeft < tabs.scrollLeft || current.offsetLeft + current.offsetWidth > tabs.scrollLeft + tabs.clientWidth)) {
      tabs.scrollLeft = current.offsetLeft - tabs.clientWidth / 2 + current.offsetWidth / 2;
    }
    const stamp = JSON.stringify([groups, state.project.activeLevel, state.project.sheets?.map((s) => [s.id, s.name, s.no]), state.project.sheetsAuto, state.project.levels.map((l) => Boolean(l.rooms.length)), Boolean(state.project.site?.boundary?.length)]);
    if (stamp !== catalogStamp) { populate(); catalogStamp = stamp; }
    picker.value = active;
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
    for (const btn of extra.values()) btn.remove();
    extra.clear();
    recent = [];
    firstPlan = null;
    schedule();
  });
  schedule();
}

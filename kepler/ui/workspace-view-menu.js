// Компактное меню видов. Активная группа и чертёж определяются заново при открытии.
import { escapeHtml } from './dom.js';

const paths = {
  plan: 'M3 4h18v16H3zM11 4v8H3m8-3h10m-6 0v6',
  roof: 'm3 11 9-7 9 7-9 7zm0 0 9 2 9-2',
  model: 'm12 2 9 5v10l-9 5-9-5V7zM3 7l9 5 9-5m-9 5v10',
  site: 'm3 5 6-2 6 3 6-2v15l-6 2-6-3-6 2zm6-2v15m6-12v15',
  landscape: 'M7 21v-5m-4 0 4-7 4 7zm13 5v-8m-5 0 5-10 5 10z',
  section: 'M3 18h18M5 15V7l7-4 7 4v8M5 11h14',
  facade: 'M3 19h18M5 19V8l7-4 7 4v11M8 11h2v2H8zm6 0h2v2h-2z',
  sheet: 'M5 2h10l4 4v16H5zM14 2v6h5M8 12h8m-8 4h5',
  analysis: 'M4 19V9m5 10V5m5 14v-7m5 7V3M3 21h18',
  ergonomics: 'M4 18h16M6 18v-4h12v4M8 14V9h8v5M12 9V5m-2 0h4',
  light: 'M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4m0-12.8L17 7M7 17l-1.4 1.4M16 12a4 4 0 1 1-8 0 4 4 0 1 1 8 0',
  engineering: 'M4 7h7v5h5V7h4M6 4v6m12-6v6m-7 4v5h5v-5',
  volume: 'm12 3 8 4v10l-8 4-8-4V7zm-8 4 8 4 8-4m-8 4v10',
  plus: 'M12 5v14M5 12h14',
  props: 'M4 7h8m5 0h3M4 17h3m5 0h8M12 5h4v4h-4zm-4 10h4v4H8z',
  check: 'm5 12 4 4 10-10',
};
export const viewIcon = (kind) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[kind]}"/></svg>`;

const categories = {
  plans: ['Планы', 'plan'],
  model: ['Модель и участок', 'model'],
  sections: ['Разрезы', 'section'],
  facades: ['Фасады', 'facade'],
  analytics: ['Аналитика', 'analysis'],
  sheets: ['Листы', 'sheet'],
};

export function bindViewMenu(nav, getData, activate) {
  const trigger = nav.querySelector('#workspaceViewPicker');
  const menu = nav.querySelector('#workspaceViewMenu');
  const groups = menu.querySelector('.wv-groups');
  const choices = menu.querySelector('.wv-choices');
  const dismiss = menu.querySelector('.wv-dismiss');
  const editor = nav.closest('.app');
  // Модальный dialog попадает в верхний слой браузера. При блокировке
  // редактора сразу уступаем этот слой окну входа, проектов или передачи прав.
  const editorLock = new MutationObserver(() => { if (editor.inert) close(); });
  let currentGroup = '';
  let data;
  let stamp = '';

  function entry([key, title, kind]) {
    const current = key === data.active;
    return `<button type="button" data-view-key="${escapeHtml(key)}"${current ? ' aria-current="true"' : ''}>
      ${viewIcon(kind)}<span>${escapeHtml(title)}</span>${current ? viewIcon('check') : ''}
    </button>`;
  }

  function showGroup(key) {
    currentGroup = key;
    for (const tab of groups.children) {
      const selected = tab.dataset.viewGroup === key;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }
    choices.setAttribute('aria-labelledby', 'wv-group-' + key);
    const [, records] = data.groups.find(([id]) => id === key);
    choices.innerHTML = records.map(entry).join('');
    if (key === 'plans' && data.actions.length) {
      choices.insertAdjacentHTML('beforeend', `<div class="wv-level-actions" role="group" aria-label="Управление этажами">${data.actions.map(entry).join('')}</div>`);
    }
    choices.scrollTop = 0;
  }

  function refresh() {
    if (!menu.open) return;
    const next = getData();
    const signature = JSON.stringify(next);
    if (stamp === signature) return;
    stamp = signature;
    data = next;
    const visible = data.groups.filter(([, list]) => list.length);
    const focused = document.activeElement;
    const key = focused?.dataset.viewKey;
    const category = focused?.dataset.viewGroup;
    groups.innerHTML = visible.map(([id]) => {
      const [label, kind] = categories[id];
      return `<button type="button" role="tab" aria-controls="workspaceViewItems" id="wv-group-${id}" data-view-group="${id}">${viewIcon(kind)}<span>${label}</span></button>`;
    }).join('');
    if (!visible.some(([id]) => id === currentGroup)) {
      currentGroup = (visible.find(([, records]) => records.some(([id]) => id === data.active)) || visible[0])[0];
    }
    showGroup(currentGroup);
    // Обновление проекта не должно сбрасывать фокус клавиатуры в открытом меню.
    if (category || key) (choices.querySelector(`[data-view-key="${CSS.escape(key || '')}"]`) || selectedTab()).focus();
  }
  const selectedTab = () => groups.querySelector('[aria-selected="true"]');
  function position() {
    if (!menu.open) return;
    const rect = trigger.getBoundingClientRect();
    menu.style.setProperty('--wv-left', rect.left + 'px');
    menu.style.setProperty('--wv-top', rect.bottom + 5 + 'px');
  }
  function close() {
    if (!menu.open) return;
    editorLock.disconnect();
    menu.close();
    trigger.setAttribute('aria-expanded', 'false');
    trigger.focus({ preventScroll: true });
  }
  function open() {
    currentGroup = '';
    stamp = '';
    menu.showModal();
    editorLock.observe(editor, { attributes: true, attributeFilter: ['inert'] });
    trigger.setAttribute('aria-expanded', 'true');
    position();
    refresh();
    selectedTab().focus({ preventScroll: true });
    choices.querySelector('[aria-current]')?.scrollIntoView({ block: 'nearest' });
  }
  trigger.addEventListener('click', open);
  dismiss.addEventListener('click', close);
  menu.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  menu.addEventListener('click', (event) => {
    // Нажатие за диалогом закрывает его, не ставя предмет на плане под пальцем.
    event.stopPropagation();
    if (event.target === menu) {
      const { left, right, top, bottom } = menu.getBoundingClientRect();
      if (event.clientX < left || event.clientX > right || event.clientY < top || event.clientY > bottom) close();
      return;
    }
    const group = event.target.closest('[data-view-group]');
    if (group) { showGroup(group.dataset.viewGroup); return; }
    const item = event.target.closest('[data-view-key]');
    if (item) { close(); activate(item.dataset.viewKey); }
  });
  menu.addEventListener('keydown', (event) => {
    event.stopPropagation();
    const tab = event.target.closest('[data-view-group]');
    const choice = event.target.closest('[data-view-key]');
    if (!tab && !choice) return;
    if (event.key === 'ArrowRight' && tab) {
      event.preventDefault();
      (choices.querySelector('[aria-current]') || choices.querySelector('button')).focus();
    } else if (event.key === 'ArrowLeft' && choice) {
      event.preventDefault();
      selectedTab().focus();
    } else if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const buttons = [...(tab ? groups : choices).querySelectorAll('button')];
      const step = event.key === 'ArrowDown' ? 1 : -1;
      const index = (buttons.indexOf(tab || choice) + step + buttons.length) % buttons.length;
      const next = buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : index];
      if (tab) showGroup(next.dataset.viewGroup);
      next.focus();
    }
  });
  menu.addEventListener('keyup', (event) => event.stopPropagation());
  window.addEventListener('resize', () => { position(); refresh(); });
  return { close, refresh };
}

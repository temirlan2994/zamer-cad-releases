// Блокирующее окно передачи облачного проекта между устройствами.
// Решение о lease и загрузке модели принимает ui/projects.js; этот модуль
// отвечает только за недвусмысленное состояние интерфейса.

import { el } from './dom.js';

let handlers = { onContinue: null, onProjects: null };
let bound = false;
let busy = false;
const previousInert = new Map();

const COPY = {
  occupied: {
    title: 'Проект открыт на другом устройстве',
    text: 'Чтобы изменения не перезаписали друг друга, редактирование здесь пока приостановлено.',
  },
  moved: {
    title: 'Проект теперь редактируется на другом устройстве',
    text: 'Редактирование здесь остановлено, чтобы не потерять изменения.',
  },
  saving: {
    title: 'Сохраняем предыдущий проект',
    text: 'Подождите, пока последние изменения будут надёжно сохранены.',
  },
};

function setPageInert(value) {
  const screen = el('editLockScreen');
  if (value) {
    previousInert.clear();
    for (const node of document.body.children) {
      if (node === screen || node.tagName === 'SCRIPT') continue;
      previousInert.set(node, Boolean(node.inert));
      node.inert = true;
    }
    return;
  }
  for (const [node, wasInert] of previousInert) node.inert = wasInert;
  previousInert.clear();
}

function invoke(name) {
  if (busy) return;
  try {
    const result = handlers[name]?.();
    result?.catch?.((error) => setEditLockBusy(false, error?.message || 'Не удалось продолжить', 'error'));
  } catch (error) {
    setEditLockBusy(false, error?.message || 'Не удалось продолжить', 'error');
  }
}

export function bindEditLockUi(next = {}) {
  handlers = {
    onContinue: typeof next.onContinue === 'function' ? next.onContinue : null,
    onProjects: typeof next.onProjects === 'function' ? next.onProjects : null,
  };
  if (bound) return;
  bound = true;
  el('editLockContinue').addEventListener('click', () => invoke('onContinue'));
  el('editLockProjects').addEventListener('click', () => invoke('onProjects'));
  // Это alertdialog без отмены: Escape не должен вернуть возможность правки
  // до подтверждённой передачи lease или выхода к списку проектов.
  window.addEventListener('keydown', (event) => {
    if (el('editLockScreen').hidden || event.key !== 'Escape') return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
}

export function showEditLock({
  kind = 'moved', deviceName = '', status = '',
} = {}) {
  const copy = COPY[kind] || COPY.moved;
  el('editLockTitle').textContent = copy.title;
  el('editLockText').textContent = copy.text;
  const device = el('editLockDevice');
  device.textContent = deviceName ? `Другое устройство: ${deviceName}` : '';
  device.hidden = !deviceName;
  const screen = el('editLockScreen');
  const wasHidden = screen.hidden;
  screen.dataset.kind = kind;
  screen.hidden = false;
  if (wasHidden) setPageInert(true);
  setEditLockBusy(false, status);
  requestAnimationFrame(() => el('editLockContinue').focus({ preventScroll: true }));
}

export function hideEditLock() {
  const screen = el('editLockScreen');
  if (screen.hidden) return;
  screen.hidden = true;
  delete screen.dataset.kind;
  setPageInert(false);
  setEditLockBusy(false, '');
}

export function setEditLockBusy(value, status = '', state = '') {
  busy = Boolean(value);
  const screen = el('editLockScreen');
  screen.setAttribute('aria-busy', String(busy));
  el('editLockContinue').disabled = busy;
  el('editLockProjects').disabled = busy;
  const node = el('editLockStatus');
  node.textContent = status;
  if (state) node.dataset.state = state; else delete node.dataset.state;
}

export function isEditLockOpen() {
  return el('editLockScreen')?.hidden === false;
}

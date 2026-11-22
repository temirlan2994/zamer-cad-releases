// Единая синхронизация названия открытого проекта с интерфейсом.

import { normalizeProjectName } from '../core/model.js';
import { state } from './state.js';

export const PRODUCT_NAME = 'kep•ler 3D';
export const PROJECT_NAME_EVENT = 'kepler:project-name';

let lastEventName = null;
let lastEventPid = null;

export function currentProjectName() {
  return normalizeProjectName(state.project?.name);
}

export { normalizeProjectName };

export function safeProjectFileName(value = state.project?.name) {
  const clean = normalizeProjectName(value, 'kep-ler-3d')
    .replace(/[^\p{L}\p{N}_ -]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
  return clean || 'kep-ler-3d';
}

// Вызывается после любой замены проекта и прямо во время набора
// названия. Событие уходит только при смене имени/проекта, чтобы обычные
// правки чертежа не перерисовывали список проектов.
export function syncProjectNameUi({ updateInput = true } = {}) {
  const name = currentProjectName();
  const input = document.getElementById('projectName');
  if (updateInput && input) input.value = name;
  document.title = `${name} — ${PRODUCT_NAME}`;

  if (lastEventName !== name || lastEventPid !== state.pid) {
    lastEventName = name;
    lastEventPid = state.pid;
    document.dispatchEvent(new CustomEvent(PROJECT_NAME_EVENT, {
      detail: { name, pid: state.pid },
    }));
  }
  return name;
}

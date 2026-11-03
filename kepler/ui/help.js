// Справка «Управление»: мышь, клавиши, пальцы, режимы. «?», F1 или кнопка
// «?» в шапке; Esc, «✕» или клик мимо карточки — закрыть.

import { el } from './dom.js';

export const isHelpOpen = () => !el('helpScreen').hidden;

export function openHelp() {
  el('helpScreen').hidden = false;
}

export function closeHelp() {
  el('helpScreen').hidden = true;
}

export function bindHelp() {
  el('helpBtn').addEventListener('click', openHelp);
  el('helpClose').addEventListener('click', closeHelp);
  el('helpScreen').addEventListener('click', (e) => { if (e.target.id === 'helpScreen') closeHelp(); });
}

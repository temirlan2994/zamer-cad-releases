// DOM: канвас, рендерер, ссылки на элементы, тосты.

import { createRenderer } from '../render.js';

export const canvas = document.getElementById('canvas');

export const renderer = createRenderer(canvas);

export function el(id) {
  return document.getElementById(id);
}

export const refs = {
  projectName: el('projectName'),
  roomCards: el('roomCards'),
  siteTools: el('siteTools'),
  libraryTitle: el('libraryTitle'),
  libraryHint: el('libraryHint'),
  props: el('propsPanel'),
  hint: el('canvasHint'),
  statusCursor: el('cursorPos'),
  statusScale: el('scaleInfo'),
  toast: el('toast'),
  fileInput: el('fileInput'),
  underlayInput: el('underlayInput'),
  exportDropdown: el('exportDropdown'),
  modePlan: el('modePlanBtn'),
  modeSite: el('modeSiteBtn'),
  furnitureBar: el('furnitureBar'),
  furnitureItems: el('furnitureItems'),
  libraryTop: el('libraryTop'),
  libraryTabs: el('libraryTabs'),
  libTabRooms: el('libTabRooms'),
  libTabFurniture: el('libTabFurniture'),
};

// Область role="status" доступна диктору и без всплывающей плашки.
export function announce(message) {
  clearTimeout(refs.toast._timer);
  refs.toast.classList.remove('show');
  refs.toast.textContent = message;
}

export function toast(message, long = false) {
  announce(message);
  refs.toast.classList.add('show');
  refs.toast._timer = setTimeout(() => refs.toast.classList.remove('show'), long ? 5200 : 2600);
}

export function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

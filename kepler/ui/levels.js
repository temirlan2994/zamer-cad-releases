// Этажи: переключатель на холсте, добавление и удаление, шаг вверх/вниз.
//
// Данные этажей — в project.levels (core/model.js); всё редактирование идёт
// на активном этаже project.activeLevel. Этаж ниже рисуется бледно.

import {
  createItem, createLevel, createRoom, levelBelow, sortedLevels,
} from '../core/model.js';
import { el, toast } from './dom.js';
import { state } from './state.js';
import { afterChange, mutate, refreshDerived } from './store.js';
import { cancelTool } from './tools.js';

export function renderLevelBar() {
  const bar = el('levelBar');
  if (!bar || !state.project) return;
  bar.innerHTML = '';
  for (const level of sortedLevels(state.project)) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('role', 'tab');
    btn.dataset.level = level.id;
    btn.textContent = level.name;
    btn.title = `${level.name}: отметка ${(level.elevation / 1000).toFixed(2)} м, высота ${(level.height / 1000).toFixed(2)} м · PgUp/PgDn`;
    const active = level.id === state.project.activeLevel;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', String(active));
    btn.addEventListener('click', () => switchLevel(level.id));
    bar.appendChild(btn);
  }
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'add';
  add.textContent = '+';
  add.title = 'Добавить этаж сверху';
  add.addEventListener('click', addLevel);
  bar.appendChild(add);
}

// Переключение этажа — не правка проекта: в историю не попадает.
export function switchLevel(id) {
  const project = state.project;
  if (id === project.activeLevel || !project.levels.some((l) => l.id === id)) return;
  cancelTool();
  state.selection = null;
  state.hover = null;
  state.ghost = null;
  project.activeLevel = id;
  refreshDerived();
  afterChange();
}

// dir: +1 — этаж выше, −1 — ниже.
export function stepLevel(dir) {
  const list = sortedLevels(state.project);
  const i = list.findIndex((l) => l.id === state.project.activeLevel);
  const next = list[i + dir];
  if (next) switchLevel(next.id);
}

const inside = (item, r) => item.x >= r.x && item.x <= r.x + r.w && item.y >= r.y && item.y <= r.y + r.h;

// Новый этаж над верхним. Лестница связывает этажи, поэтому помещения
// «Лестница» (вместе с маршем внутри) переносятся на то же место.
export function addLevel() {
  const project = state.project;
  const list = sortedLevels(project);
  const top = list[list.length - 1];
  const level = createLevel(`${list.length + 1} этаж`, top.elevation + top.height, top.height);
  const stairs = top.rooms.filter((r) => r.type === 'stairs-room');
  cancelTool();
  state.selection = null;
  mutate(() => {
    for (const s of stairs) {
      const copy = createRoom('stairs-room', s.x, s.y, s.w, s.h);
      copy.name = s.name;
      level.rooms.push(copy);
      for (const it of top.items) {
        if (inside(it, s)) level.items.push(createItem(it.kind, it.x, it.y, it.w, it.h, it.rotation || 0));
      }
    }
    project.levels.push(level);
    project.activeLevel = level.id;
  });
  toast(stairs.length
    ? `Добавлен «${level.name}»: лестница перенесена с этажа ниже, его стены видны бледно`
    : `Добавлен «${level.name}»: стены этажа ниже видны бледно — ставьте комнаты над ними`, true);
}

export function deleteLevel(id) {
  const project = state.project;
  if (project.levels.length <= 1) { toast('Единственный этаж удалить нельзя'); return; }
  const level = project.levels.find((l) => l.id === id);
  if (!level) return;
  const fallback = levelBelow(project, id) || sortedLevels(project).find((l) => l.id !== id);
  cancelTool();
  state.selection = null;
  mutate(() => {
    project.levels = project.levels.filter((l) => l.id !== id);
    if (project.activeLevel === id) project.activeLevel = fallback.id;
  });
  toast(`«${level.name}» удалён — Ctrl+Z вернёт`);
}

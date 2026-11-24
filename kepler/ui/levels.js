// Этажи: переключатель на холсте, добавление и удаление, шаг вверх/вниз.
//
// Данные этажей — в project.levels (core/model.js); всё редактирование идёт
// на активном этаже project.activeLevel. Этаж ниже рисуется бледно.

import {
  createItem, createLevel, createRoom, levelBelow, levelTallWindowOffsets, setLevelTallWindowOffsets, sortedLevels,
} from '../core/model.js';
import { removeOwnedAtriums } from '../core/slab-openings.js';
import { roomsIntersect } from '../core/v7/eat-bridge.js';
import { el, refs, toast } from './dom.js';
import { setEditorMode } from './modes.js';
import { state } from './state.js';
import { afterChange, mutate, refreshDerived } from './store.js';
import { cancelTool, selectObject } from './tools.js';
import { scaleLabel } from './view.js';

export function renderLevelBar() {
  const bar = el('levelBar');
  if (!bar || !state.project) return;
  const landscape = state.modeName === 'landscape';
  const chip = el('landscapeBtn');
  if (chip) {
    chip.classList.toggle('active', landscape);
    chip.setAttribute('aria-pressed', String(landscape));
  }
  bar.innerHTML = '';
  for (const level of sortedLevels(state.project)) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('role', 'tab');
    btn.dataset.level = level.id;
    btn.textContent = level.name;
    btn.title = `${level.name}: отметка ${(level.elevation / 1000).toFixed(2)} м, высота ${(level.height / 1000).toFixed(2)} м · PgUp/PgDn`;
    const active = !landscape && level.id === state.project.activeLevel;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', String(active));
    btn.addEventListener('click', () => {
      // Из «Ландшафта» клик по этажу возвращает в «План».
      if (state.modeName === 'landscape') setEditorMode('plan');
      if (state.roofPlan) { // с «Плана крыши» клик по этажу — к плану этажа
        state.roofPlan = false;
        document.body.classList.remove('mode-roofplan');
        document.dispatchEvent(new CustomEvent('kepler:view'));
      }
      switchLevel(level.id);
    });
    bar.appendChild(btn);
  }
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'add';
  add.textContent = '+';
  add.title = 'Добавить этаж сверху';
  add.addEventListener('click', () => {
    if (state.modeName === 'landscape') setEditorMode('plan');
    addLevel();
  });
  bar.appendChild(add);
}

// Панорамирование и масштаб принадлежат вкладке плана. Рабочий этаж
// модели 3D можно менять независимо, не сдвигая соответствующие чертежи.
const planCameras = new WeakMap();
function cameraMap(project) {
  let cameras = planCameras.get(project);
  if (!cameras) { cameras = new Map(); planCameras.set(project, cameras); }
  return cameras;
}

export function savePlanCamera(project = state.project, levelId = project?.activeLevel, camera = state.view) {
  if (!project || !levelId || !camera) return null;
  const { scale, panX, panY, rotation } = camera;
  const { x = 0, y = 0 } = project.building?.origin || {};
  const saved = { scale, panX, panY, rotation, x, y };
  cameraMap(project).set(levelId, saved);
  return saved;
}

function rememberPlan(project) {
  savePlanCamera(project, project.activeLevel, state.view);
  const cameras = cameraMap(project);
  return cameras;
}

// Аналитические виды используют тот же исходный план этажа, но хранят свою
// камеру отдельно. Даём контроллеру прочитать уже посещённую камеру плана,
// не применяя её преждевременно во время switchLevel.
export function savedPlanCamera(project, levelId) {
  const saved = planCameras.get(project)?.get(levelId) || null;
  const origin = project?.building?.origin;
  if (!saved || saved.x !== (origin?.x ?? 0) || saved.y !== (origin?.y ?? 0)) return null;
  return {
    scale: saved.scale,
    panX: saved.panX,
    panY: saved.panY,
    rotation: saved.rotation,
  };
}

export function restorePlanCamera(project, levelId) {
  const saved = savedPlanCamera(project, levelId);
  if (!saved) return null;
  Object.assign(state.view, saved);
  if (refs.statusScale) refs.statusScale.textContent = scaleLabel();
  return saved;
}

// Переключение этажа — не правка проекта: в историю не попадает.
export function switchLevel(id, {
  // Аналитический вид хранит собственную камеру. Пока он открыт, смена
  // этажа не должна записывать её в WeakMap обычных планов и подменять
  // камерой целевого плана: контроллер аналитики сохранит/восстановит обе
  // камеры после PROJECT_CHANGE.
  planView = state.modeName === 'plan' && !state.analyticalView
    && !document.body.classList.contains('v3-open'),
} = {}) {
  const project = state.project;
  if (id === project.activeLevel || !project.levels.some((l) => l.id === id)) return;
  cancelTool();
  state.selection = null;
  state.hover = null;
  state.ghost = null;
  state.ghostItem = null;
  if (planView) {
    const saved = rememberPlan(project).get(id);
    const origin = project.building?.origin;
    if (saved && saved.rotation === state.view.rotation && saved.x === (origin?.x ?? 0) && saved.y === (origin?.y ?? 0)) {
      Object.assign(state.view, { scale: saved.scale, panX: saved.panX, panY: saved.panY });
      refs.statusScale.textContent = scaleLabel();
    }
  }
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
function makeNextLevel(list) {
  const top = list.at(-1);
  const level = createLevel(`${list.length + 1} этаж`, top.elevation + top.height, top.height);
  setLevelTallWindowOffsets(level, levelTallWindowOffsets(top));
  const stairs = top.rooms.filter((r) => r.type === 'stairs-room');
  for (const s of stairs) {
    const copy = createRoom('stairs-room', s.x, s.y, s.w, s.h);
    copy.name = s.name;
    level.rooms.push(copy);
    for (const it of top.items) {
      if (!inside(it, s)) continue;
      const copyItem = createItem(it.kind, it.x, it.y, it.w, it.h, it.rotation || 0);
      if (it.comp) copyItem.comp = JSON.parse(JSON.stringify(it.comp));
      if (it.kind === 'stairs') {
        copyItem.stairShape = it.stairShape;
        // Марши и площадки — как у нижней (core/stairs.js), этаж — свой.
        for (const key of ['flightWidth', 'going', 'flights', 'gap', 'landingDepth', 'landings', 'mirrored']) {
          if (it[key] !== undefined) copyItem[key] = structuredClone(it[key]);
        }
        copyItem.floorHeight = level.height;
      }
      level.items.push(copyItem);
    }
  }
  return level;
}

export function addLevel() {
  const project = state.project;
  if (state.modeName === 'plan' && !state.analyticalView) rememberPlan(project);
  const level = makeNextLevel(sortedLevels(project));
  cancelTool();
  state.selection = null;
  const added = mutate(() => {
    project.levels.push(level);
    project.activeLevel = level.id;
  });
  if (added) toast(level.rooms.length
    ? `Добавлен «${level.name}»: лестница перенесена с этажа ниже, его стены видны бледно`
    : `Добавлен «${level.name}»: стены этажа ниже видны бледно — ставьте комнаты над ними`, true);
}

export function addRoomAbove(room) {
  const project = state.project;
  if (state.editLocked || !project.rooms.includes(room)) return;
  const levels = sortedLevels(project);
  const index = levels.findIndex((level) => level.id === project.activeLevel);
  const existing = levels[index + 1];
  const level = existing || makeNextLevel(levels);
  const occupied = level.rooms.find((other) => roomsIntersect(room, other));
  if (occupied) {
    toast(`На этаже «${level.name}» это место занимает «${occupied.name}»`, true);
    return;
  }
  const copy = createRoom(room.type, room.x, room.y, room.w, room.h);
  copy.name = room.name;
  if (room.outline) copy.outline = structuredClone(room.outline);
  if (room.notch) copy.notch = structuredClone(room.notch);
  if (!document.body.classList.contains('v3-open')) rememberPlan(project);
  cancelTool();
  const added = mutate(() => {
    if (!existing) project.levels.push(level);
    level.rooms.push(copy);
    project.activeLevel = level.id;
    state.selection = { type: 'room', id: copy.id };
  });
  if (added) {
    selectObject({ type: 'room', id: copy.id });
    toast(`«${copy.name}» добавлена на «${level.name}». Тип и размеры можно изменить в свойствах.`);
  }
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
    removeOwnedAtriums(project, id);
    project.levels = project.levels.filter((l) => l.id !== id);
    for (const other of project.levels) {
      for (const opening of other.openings) if (opening.span?.levelId === id) delete opening.span;
    }
    if (project.activeLevel === id) project.activeLevel = fallback.id;
  });
  toast(`«${level.name}» удалён — Ctrl+Z вернёт`);
}

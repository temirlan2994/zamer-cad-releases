// Изменения проекта: транзакции с историей, отмена/повтор, автосохранение.

import { normsReport } from '../core/norms.js';
import { itemsInRoom } from '../core/furnish.js';
import {
  deserializeProject, hasContent, levelBelow, levelProject, projectFromData, serializeProject,
} from '../core/model.js';
import { hashText, newId } from '../core/storage.js';
import { deriveWalls, doorLink, wallRects } from '../core/walls.js';
import { freeLoops } from '../core/bound-rooms.js';
import { reconcileEats } from '../core/v7/eat-bridge.js';
import { syncGridPins } from '../core/grid-pins.js';
import { syncStairLevels } from '../core/slab-openings.js';
import { setStairRise } from '../core/stairs.js';
import { findNearMissGaps } from '../core/gaps.js';
import { roomRects } from '../core/room-shape.js';
import { collectIssues } from '../core/issues.js';
import { el, toast } from './dom.js';
import { getBlob, putBlob } from './localdb.js';
import { renderLevelBar } from './levels.js';
import { applyModeRotation } from './modes.js';
import { renderViewPanel } from './view-align.js';
import { renderProps } from './props.js';
import { history, state } from './state.js';
import { issueGroupsEnabled, setIssues } from './issues.js';
import { ergoFindings, ergoOn } from './render-ergonomics.js';
import { updateDimModeBtn } from './toolbar.js';
import { renderSelectionToolbar } from './selection-toolbar.js';
import { syncUnderlayImage } from './underlay.js';
import { requestDraw } from './view.js';
import { refresh3d } from './view3d.js';
import { arrangeRoomsNow, AUTO_LAYOUT_AVAILABLE } from './auto-layout.js';

export const AUTOSAVE_KEY = 'kepler-plan-autosave';
export const PID_KEY = 'kepler-plan-pid'; // какой проект из «Проектов» сейчас открыт
export const BROKEN_KEY = `${AUTOSAVE_KEY}-broken`; // резерв битого автосохранения
const OWNER_KEY = `${AUTOSAVE_KEY}-tab`; // какая вкладка записала автосохранение последней
const TAB_ID = newId('tab');

let autosaveTimer = null;
let autosaveDirty = false;
let heavyPending = false; // подложка из автосохранения ещё читается из IndexedDB
const warned = new Set();

// Стены, зазоры и стены этажа ниже — без записи в state (проверка до замены).
function deriveAll(project) {
  const below = levelBelow(project);
  const walls = deriveWalls(project);
  return {
    walls,
    // Замкнутые петли ручных стен без помещения — штриховка «не назначено».
    freeLoops: freeLoops(project, walls),
    gaps: findNearMissGaps(project, { move: false }),
    // Стены этажа ниже — бледная подложка, чтобы ставить стены над стенами.
    belowWalls: below ? deriveWalls(levelProject(project, below.id)) : null,
  };
}

export function refreshDerived() {
  Object.assign(state, deriveAll(state.project));
}

// ---------------------------------------------------------------- Снимки истории
//
// Снимок — JSON без отступов, а тяжёлые строки data:… (подложка в base64)
// заменены ссылкой kmem:<хеш> на одну копию в памяти: 40 шагов отмены не
// держат 40 копий картинки. restoreFrom понимает такие ссылки.

const HEAVY_MIN = 4096;
const MEM_REF = 'kmem:';
const IDB_REF = 'kidb:';
const heavyIds = new Map(); // строка → хеш
const heavyById = new Map(); // хеш → строка
const isHeavy = (v) => typeof v === 'string' && v.length > HEAVY_MIN && v.startsWith('data:');

function heavyId(s) {
  let id = heavyIds.get(s);
  if (!id) {
    id = hashText(s);
    heavyIds.set(s, id);
    heavyById.set(id, s);
  }
  return id;
}

export function snapshot() {
  return JSON.stringify(state.project, (_k, v) => (isHeavy(v) ? MEM_REF + heavyId(v) : v));
}

// Текст проекта (файл, автосохранение или снимок истории) → проект.
export function parseProjectText(text) {
  if (!String(text).includes(`"${MEM_REF}`)) return deserializeProject(text);
  let raw;
  try {
    raw = JSON.parse(text, (_k, v) => (typeof v === 'string' && v.startsWith(MEM_REF) ? heavyById.get(v.slice(MEM_REF.length)) ?? null : v));
  } catch {
    throw new Error('Файл не является JSON-проектом Kepler Plan');
  }
  return projectFromData(raw);
}

// Снимок для истории при замене проекта целиком (пример, шаблон, файл,
// «Новый»). Пустой проект в историю не кладём: Ctrl+Z после загрузки не
// должен подменять результат пустым «Новым домом». Содержимое — не только
// комнаты: ландшафт, граница, рельеф, подложка тоже (core/model.js hasContent).
export function snapshotIfContent() {
  return hasContent(state.project) ? snapshot() : null;
}

// Запись истории = снимок + идентификатор проекта из «Проектов»: отмена после
// открытия другого проекта возвращает и содержимое, и привязку (pid), иначе
// «Сохранить версию» записала бы чужой проект поверх своего.
export function pushHistory(before, pid = state.pid) {
  history.undo.push({ text: before, pid });
  if (history.undo.length > 40) history.undo.shift();
  history.redo.length = 0;
}

// Комнаты, у которых внутри mutate изменилась именно usable-геометрия или
// проёмы. Координаты x/y намеренно не сравниваются: при обычном переносе
// комната везёт мебель вместе с собой и перестраивать её не нужно.
function changedLayoutRooms(beforeText) {
  const empty = { levels: new Map() };
  if (state.project?.settings?.autoArrangeFurniture === false) return empty;
  let oldProject;
  try { oldProject = parseProjectText(beforeText); } catch { return empty; }
  const shapeKey = (room) => JSON.stringify([
    room?.type, room?.w, room?.h, room?.parentId || null,
    room?.outline || null, room?.notch || null, room?.poly || null, room?.holes || null,
    room?.eatBase?.by || null,
  ]);
  const openingKey = (opening) => JSON.stringify([
    opening.kind, opening.roomId || null, opening.host || null, opening.side ?? null,
    opening.offset ?? null, opening.width ?? null, opening.height ?? null, opening.sill ?? null,
    opening.type || null, opening.swingIn ?? null, opening.hingeStart ?? null, opening.orphan === true,
  ]);
  const manualRects = (walls) => walls
    .filter((wall) => wall.kind === 'manual' || wall.source === 'manual')
    .flatMap((wall) => wallRects(wall));
  const overlap = (a, b) => Math.min(a.x + a.w, b.x + b.w) > Math.max(a.x, b.x) + 0.5 &&
    Math.min(a.y + a.h, b.y + b.h) > Math.max(a.y, b.y) + 0.5;
  const addOpeningRooms = (ids, project, opening, walls) => {
    if (!opening) return;
    if (opening.roomId) ids.add(opening.roomId);
    if (opening.kind !== 'door') return;
    for (const roomId of doorLink(project, opening, walls) || []) {
      if (roomId !== 'outside' && project.rooms.some((room) => room.id === roomId)) ids.add(roomId);
    }
  };
  const oldLevelIds = new Set((oldProject.levels || []).map((level) => level.id));
  const levels = new Map();
  for (const currentLevel of state.project.levels || []) {
    if (!oldLevelIds.has(currentLevel.id)) continue;
    const currentProject = levelProject(state.project, currentLevel.id);
    const previousProject = levelProject(oldProject, currentLevel.id);
    const oldRooms = new Map((previousProject.rooms || []).map((room) => [room.id, room]));
    const currentRooms = new Map((currentProject.rooms || []).map((room) => [room.id, room]));
    const ids = new Set();
    for (const room of currentProject.rooms || []) {
      const old = oldRooms.get(room.id);
      if (old && shapeKey(old) !== shapeKey(room)) ids.add(room.id);
      if ((old?.parentId || null) !== (room.parentId || null)) {
        if (old?.parentId) ids.add(old.parentId);
        if (room.parentId) ids.add(room.parentId);
      }
    }
    // Удаление вложенной комнаты освобождает площадь родителя, хотя его
    // собственный контур не меняется.
    for (const old of oldRooms.values()) {
      if (!currentRooms.has(old.id) && old.parentId && currentRooms.has(old.parentId)) ids.add(old.parentId);
    }

    const oldOpenings = new Map((previousProject.openings || []).map((opening) => [opening.id, opening]));
    const currentOpenings = new Map((currentProject.openings || []).map((opening) => [opening.id, opening]));
    const oldWalls = deriveWalls(previousProject);
    const currentWalls = currentLevel.id === state.project.activeLevel ? state.walls : deriveWalls(currentProject);
    if (JSON.stringify(previousProject.walls || []) !== JSON.stringify(currentProject.walls || [])) {
      const oldObstacles = manualRects(oldWalls);
      const currentObstacles = manualRects(currentWalls);
      for (const room of previousProject.rooms || []) {
        if (roomRects(room).some((part) => oldObstacles.some((wall) => overlap(part, wall)))) ids.add(room.id);
      }
      for (const room of currentProject.rooms || []) {
        if (roomRects(room).some((part) => currentObstacles.some((wall) => overlap(part, wall)))) ids.add(room.id);
      }
    }
    for (const id of new Set([...oldOpenings.keys(), ...currentOpenings.keys()])) {
      const old = oldOpenings.get(id); const current = currentOpenings.get(id);
      if (openingKey(old || {}) === openingKey(current || {})) continue;
      addOpeningRooms(ids, previousProject, old, oldWalls);
      addOpeningRooms(ids, currentProject, current, currentWalls);
    }
    if (!ids.size) continue;
    const itemIdsByRoom = new Map();
    for (const roomId of ids) {
      const oldRoom = oldRooms.get(roomId);
      if (oldRoom) itemIdsByRoom.set(roomId, itemsInRoom(previousProject, oldRoom).map((item) => item.id));
    }
    levels.set(currentLevel.id, { roomIds: [...ids], itemIdsByRoom });
  }
  return { levels };
}

// Автоперестройка геометрически изменившихся комнат как часть уже начатой
// транзакции. Историю и перерисовку helper не создаёт: вызывающая операция
// затем делает один pushHistory(before) и один afterChange().
export function reflowLayoutChanges(beforeText, { roomIds = [], force = false } = {}) {
  if (!AUTO_LAYOUT_AVAILABLE) return { applied: 0, reports: [] };
  const changed = changedLayoutRooms(beforeText);
  const activeLevelId = state.project.activeLevel;
  const active = changed.levels.get(activeLevelId) || { roomIds: [], itemIdsByRoom: new Map() };
  active.roomIds = [...new Set([...(roomIds || []), ...active.roomIds])];
  if (active.roomIds.length) changed.levels.set(activeLevelId, active);
  let applied = 0;
  const reports = [];
  for (const [levelId, levelChange] of changed.levels) {
    const result = arrangeRoomsNow(levelChange.roomIds, {
      force: force && levelId === activeLevelId,
      itemIdsByRoom: levelChange.itemIdsByRoom,
      levelId,
    });
    applied += result.applied;
    reports.push(...result.reports);
  }
  return { applied, reports };
}

export function mutate(fn, { arrange = [], skipHistory = false } = {}) {
  const before = snapshot();
  fn();
  // Лестница «ведёт на этаж»: подъём — по отметкам этажей (core/slab-openings.js).
  if (state.project) syncStairLevels(state.project, setStairRise);
  // Съедание — производное номинальных форм: после любой правки считается
  // заново (core/v7/eat-bridge.js), результат не зависит от порядка действий.
  if (state.project) reconcileEats(state.project);
  refreshDerived();
  reflowLayoutChanges(before, { roomIds: arrange, force: arrange.length > 0 });
  if (!skipHistory) pushHistory(before);
  afterChange();
}

// Лёгкое изменение без истории (настройки солнца, прозрачность подложки).
export function tweak(fn) {
  fn();
  scheduleAutosave();
  requestDraw();
}

// Нормы (инсоляция, площади, свет, высота) — пересчёт после изменений.
export function refreshNorms() {
  try {
    state.norms = normsReport(state.project);
  } catch (error) {
    state.norms = null;
    console.error('Нормы не посчитались:', error);
  }
}

// Замечания (кнопка «⚠» на холсте): связность, нормы, зазоры — после норм.
export function refreshIssues() {
  try {
    setIssues(collectIssues(state.project, {
      norms: state.norms, walls: state.walls, gaps: state.gaps,
      // Группа «Эргономика» — пока включён режим (ui/ergonomics.js).
      enabled: ergoOn() ? [...issueGroupsEnabled(), 'ergo'] : issueGroupsEnabled(),
      ergo: ergoFindings(),
    }));
  } catch (error) {
    setIssues(null);
    console.error('Замечания не посчитались:', error);
  }
}

export function afterChange() {
  // Привязки стен к осям (core/grid-pins.js): грань ушла с оси — привязка снята.
  if (state.project && syncGridPins(state.project).dropped) toast('Стена отвязана от оси');
  syncUnderlayImage();
  refreshNorms();
  refreshIssues();
  renderProps();
  renderSelectionToolbar();
  updateDimModeBtn();
  renderLevelBar();
  refresh3d(); // открытый 3D-вид следует за правками
  renderViewPanel(); // угол вида режима (поле, «Сбросить», активная кнопка)
  requestDraw();
  scheduleAutosave();
}

// ---------------------------------------------------------------- Автосохранение
//
// localStorage, JSON без отступов, через 500 мс после правки; на pagehide и
// при сворачивании вкладки — сразу (flushAutosave). Не хватает места —
// тяжёлое (подложка) уходит в IndexedDB, в localStorage — ссылки kidb:<хеш>;
// не помогло — предупреждение один раз за сессию.

function warnOnce(kind, message) {
  if (warned.has(kind)) return;
  warned.add(kind);
  toast(message, true);
}

function scheduleAutosave() {
  autosaveDirty = true;
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(flushAutosave, 500);
}

function trySet(text) {
  try {
    localStorage.setItem(AUTOSAVE_KEY, text);
  } catch {
    return false;
  }
  try {
    localStorage.setItem(PID_KEY, state.pid || '');
    localStorage.setItem(OWNER_KEY, TAB_ID);
  } catch { /* главное записано */ }
  return true;
}

const storedBlobs = new Set();

// Немедленная запись (без дебаунса). true — записано.
export function flushAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = null;
  if (!autosaveDirty || !state.project) return false;
  if (heavyPending) { // подложка ещё не вернулась из IndexedDB — не затирать её
    autosaveTimer = setTimeout(flushAutosave, 300);
    return false;
  }
  autosaveDirty = false;
  let text;
  try {
    text = serializeProject(state.project, { pretty: false });
  } catch (error) {
    console.error('Автосохранение: проект не сериализуется', error);
    return false;
  }
  if (trySet(text)) return true;
  const blobs = {};
  const lite = JSON.stringify(state.project, (_k, v) => {
    if (!isHeavy(v)) return v;
    const h = heavyId(v);
    blobs[h] = v;
    return IDB_REF + h;
  });
  if (lite.length < text.length && trySet(lite)) {
    for (const [h, s] of Object.entries(blobs)) {
      if (storedBlobs.has(h)) continue;
      storedBlobs.add(h);
      putBlob(h, s).catch(() => {
        storedBlobs.delete(h);
        warnOnce('blob', 'Подложка не автосохраняется: в браузере нет места. Сохраните проект файлом.');
      });
    }
    warnOnce('lite', 'Мало места в браузере: подложка автосохраняется отдельно. Надёжнее сохранить версию или файл.');
    return true;
  }
  warnOnce('quota', 'Автосохранение не работает: в браузере кончилось место. Сохраните версию («Проекты») или файл.');
  return false;
}

// Запись при закрытии/сворачивании вкладки и предупреждение о второй вкладке.
export function bindAutosaveLifecycle() {
  window.addEventListener('pagehide', () => { flushAutosave(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushAutosave();
  });
  window.addEventListener('storage', (e) => {
    if (e.key === OWNER_KEY && e.newValue && e.newValue !== TAB_ID) {
      warnOnce('tabs', 'Проект открыт ещё в одной вкладке: автосохранение у них общее, и последняя правка перезапишет другую. Работайте в одной вкладке.');
    }
  });
}

// Битое автосохранение — в резервный ключ (место освобождаем, если нужно);
// не вышло — в IndexedDB.
function backupBroken(text) {
  try {
    localStorage.setItem(BROKEN_KEY, text);
    return;
  } catch { /* нет места — ниже */ }
  try {
    localStorage.removeItem(AUTOSAVE_KEY);
    localStorage.setItem(BROKEN_KEY, text);
    return;
  } catch { /* и так нет */ }
  putBlob(BROKEN_KEY, text).catch(() => {});
}

// Ссылки kidb:<хеш> → null; держатели запоминаются, чтобы вернуть данные
// из IndexedDB после старта.
function detachIdbRefs(node, out) {
  if (!node || typeof node !== 'object') return;
  for (const [k, v] of Object.entries(node)) {
    if (typeof v === 'string' && v.startsWith(IDB_REF)) {
      out.push({ holder: node, key: k, id: v.slice(IDB_REF.length) });
      node[k] = null;
    } else if (v && typeof v === 'object') detachIdbRefs(v, out);
  }
}

// Чтение автосохранения при запуске. Ничего не бросает:
// { project } — проект (или null, если сохранения нет/оно пустое);
// { broken, error } — сохранение не открылось, копия убрана в резерв.
export function loadAutosave() {
  let saved;
  try { saved = localStorage.getItem(AUTOSAVE_KEY); } catch { return { project: null }; }
  if (!saved) return { project: null };
  try {
    const project = deserializeProject(saved);
    const refs = [];
    detachIdbRefs(project, refs);
    deriveAll(project); // упадёт здесь, а не после замены проекта
    if (!hasContent(project) && !refs.length) return { project: null };
    return { project, refs };
  } catch (error) {
    console.error('Автосохранение не открылось:', error);
    backupBroken(saved);
    return { project: null, broken: saved, error };
  }
}

// Вернуть подложку из IndexedDB в открытый при запуске проект.
export function restoreHeavyRefs(project, refs) {
  if (!refs?.length) return;
  heavyPending = true;
  Promise.all(refs.map((r) => getBlob(r.id).then((s) => ({ ...r, s }), () => ({ ...r, s: null }))))
    .then((list) => {
      heavyPending = false;
      if (state.project !== project) return;
      let lost = false;
      for (const r of list) {
        if (r.s) { r.holder[r.key] = r.s; storedBlobs.add(r.id); } else lost = true;
      }
      if (lost) toast('Картинка подложки из автосохранения не нашлась — загрузите её заново', true);
      syncUnderlayImage();
      requestDraw();
    });
}

// Замена проекта текстом (файл, версия, отмена). Сначала разбор и расчёт
// стен на новом проекте; бросило — текущий проект не тронут. Сломалось
// уже после замены — откат к прежнему и ошибка наружу.
export function restoreFrom(text) {
  const project = parseProjectText(text);
  const derived = deriveAll(project);
  const prev = {
    project: state.project,
    selection: state.selection,
    rejected: new Map(state.rejected),
    layoutVariants: new Map(state.layoutVariants),
  };
  state.project = project;
  Object.assign(state, derived);
  state.selection = null;
  state.rejected.clear();
  state.layoutVariants.clear();
  try {
    const name = el('projectName');
    if (name) name.value = state.project.name;
    applyModeRotation();
    afterChange();
  } catch (error) {
    state.project = prev.project;
    state.selection = prev.selection;
    state.rejected = prev.rejected;
    state.layoutVariants = prev.layoutVariants;
    try {
      refreshDerived();
      const name = el('projectName');
      if (name) name.value = state.project.name;
      applyModeRotation();
      afterChange();
    } catch { /* прежний проект рисовался — должен и сейчас */ }
    throw error;
  }
}

// Шаг истории: текущее — в стек to, запись из from — в проект. Не открылась
// запись — стеки как были.
function step(from, to) {
  if (!from.length) return;
  const current = { text: snapshot(), pid: state.pid };
  const entry = from.pop();
  try {
    restoreFrom(entry.text);
  } catch (error) {
    from.push(entry);
    console.error('Шаг истории не применился:', error);
    toast(`Не удалось: ${error.message}`, true);
    return;
  }
  to.push(current);
  state.pid = entry.pid;
}

export function undo() { step(history.undo, history.redo); }

export function redo() { step(history.redo, history.undo); }

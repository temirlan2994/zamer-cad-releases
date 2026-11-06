// Изменения проекта: транзакции с историей, отмена/повтор, автосохранение.

import { arrangeRoom } from '../core/furnish.js';
import { normsReport } from '../core/norms.js';
import {
  deserializeProject, hasContent, levelBelow, levelProject, projectFromData, roomById, serializeProject,
} from '../core/model.js';
import { hashText, newId } from '../core/storage.js';
import { deriveWalls } from '../core/walls.js';
import { resolveBoundRooms } from '../core/bound-rooms.js';
import { findNearMissGaps } from '../core/gaps.js';
import { el, toast } from './dom.js';
import { getBlob, putBlob } from './localdb.js';
import { renderLevelBar } from './levels.js';
import { applyModeRotation } from './modes.js';
import { renderProps } from './props.js';
import { history, state } from './state.js';
import { updateConnectivity } from './status.js';
import { updateDimModeBtn } from './toolbar.js';
import { renderSelectionToolbar } from './selection-toolbar.js';
import { syncUnderlayImage } from './underlay.js';
import { requestDraw } from './view.js';
import { refresh3d } from './view3d.js';

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
  // Помещения по стенам: контуры следуют за стенами (кеш в room.poly).
  const loops = resolveBoundRooms(project, walls);
  return {
    walls,
    freeLoops: loops.free,
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

export function mutate(fn, { arrange = [], skipHistory = false } = {}) {
  const before = snapshot();
  fn();
  refreshDerived();
  for (const roomId of new Set(arrange)) {
    const room = roomById(state.project, roomId);
    if (room) state.rejected.set(roomId, arrangeRoom(state.project, room, state.walls));
  }
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

export function afterChange() {
  syncUnderlayImage();
  updateConnectivity();
  refreshNorms();
  renderProps();
  renderSelectionToolbar();
  updateDimModeBtn();
  renderLevelBar();
  refresh3d(); // открытый 3D-вид следует за правками
  el('alignBtn')?.classList.toggle('active', Boolean(state.project?.building?.rotation));
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
  const prev = { project: state.project, selection: state.selection };
  state.project = project;
  Object.assign(state, derived);
  state.selection = null;
  try {
    const name = el('projectName');
    if (name) name.value = state.project.name;
    applyModeRotation();
    afterChange();
  } catch (error) {
    state.project = prev.project;
    state.selection = prev.selection;
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

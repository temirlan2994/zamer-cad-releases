// Выделение и активный инструмент (размещение, рисование, правка слоя).

import { roomType } from '../core/catalog.js';
import { canvas, el, refs } from './dom.js';
import { renderIssues } from './issues.js';
import { renderLibrary } from './library.js';
import { defaultOpeningPreset } from '../core/opening-preset.js';
import { renderProps } from './props.js';
import { state } from './state.js';
import { renderSelectionToolbar } from './selection-toolbar.js';
import { closeLibrarySheet } from './mobile.js';
import { hideSplitInput, pendingSplitHas, positionSplitInput, revertPendingSplit } from './split-input.js';
import { requestDraw } from './view.js';
import { refresh3dSelection } from './view3d.js';
import { clearDrawSnap } from './draw-snap-ui.js';
import { groupHandleId } from '../core/group-handles.js';
import { lsHandleKey } from '../core/landscape-handles.js';
import { isRoofPlan } from './plan-roofs.js';
import { cancelEditingGesture } from './edit-guard.js';
import { isGlazedAssembly } from '../core/glazed-openings.js';

export function selectObject(selection) {
  // Касание: выбор откладывается до тапа (ui/input.js), чтобы панорама пальцем
  // ничего не выделяла.
  if (state.touchDeferSelect) { state.touchDeferred = { selection }; return; }
  if (state.tool?.kind === 'move-furniture') cancelTool();
  const split = state.splitEdit;
  if (split && (selection?.type !== 'wall' || selection.key !== split.key ||
    Math.abs((selection.from ?? split.from) - split.from) >= 1)) hideSplitInput();
  // Несдвинутое деление стены откатывается, если выбрали не его комнату.
  if (state.pendingRoomSplit && (!selection || selection.type !== 'room' || !pendingSplitHas(selection.id))) {
    revertPendingSplit();
  }
  const handleOwner = selection?.type === 'item' ? selection.id : selection?.type === 'landscape' ? lsHandleKey(selection) : groupHandleId(selection);
  if (!(handleOwner && state.itemHandle?.id === handleOwner)) state.itemHandle = null;
  state.selection = selection;
  renderIssues(); // «Пристыковать (сдвинуть …)» и отметка выбранного в списке замечаний
  renderProps();
  updateWallButtons();
  renderSelectionToolbar();
  refresh3dSelection(); // открытый 3D подсвечивает тот же выбор
  requestDraw();
}

// Плавающие кнопки «+ дверь / + окно» у середины выбранной стены.
function updateWallButtons() {
  // Оставлена точка вызова для старых обработчиков вида; плавающей панели
  // стены больше нет — все команды находятся в selectionToolbar.
}

export function positionWallButtons() {
  // Панель закреплена сверху; у стены остаётся только плашка деления.
  positionSplitInput();
}

export function setHint(text) {
  refs.hint.textContent = text;
  refs.hint.hidden = !text;
}

export function setTool(tool, hint) {
  if (state.tool?.kind === 'move-furniture') cancelTool();
  const profile = el('lsRouteProfile');
  if (profile) profile.hidden = true;
  // Инструмент плана этажа на «Плане крыши» — назад к плану этажа.
  if (isRoofPlan() && tool && tool.kind !== 'roof' && tool.kind !== 'align-view') {
    state.roofPlan = false;
    document.body.classList.remove('mode-roofplan');
    document.dispatchEvent(new CustomEvent('kepler:view'));
  }
  state.tool = tool;
  state.draft = null;
  clearDrawSnap();
  for (const id of ['viewsAlignBtn', 'viewBtn']) el(id)?.classList.toggle('armed', tool?.kind === 'align-view');
  state.ghostLandscape = null;
  state.ghost = null;
  state.ghostItem = null;
  state.ghostOpening = null;
  state.ghostOpeningFull = null;
  state.ghostDoor = null;
  setHint(hint || '');
  renderLibrary();
  renderSelectionToolbar();
  requestDraw();
}

export function cancelTool() {
  if (state.tool?.kind === 'move-furniture') {
    // Убираем инструмент до отката: restoreFrom может обновить интерфейс.
    state.tool = null;
    cancelEditingGesture();
    canvas.style.cursor = '';
  }
  const profile = el('lsRouteProfile');
  if (profile) profile.hidden = true;
  const wasOpening = state.tool?.kind === 'place-opening';
  state.tool = null;
  state.draft = null;
  state.gridSnapTag = null; // подпись привязки («центр стены», «Ось 3»)
  clearDrawSnap();
  state.ghost = null;
  state.ghostItem = null;
  state.ghostOpening = null;
  state.ghostOpeningFull = null;
  state.calibration = null;
  state.entryGhost = null;
  state.calCursor = null;
  state.northCursor = null;
  state.alignCursor = null;
  for (const id of ['viewsAlignBtn', 'viewBtn']) el(id)?.classList.remove('armed'); // «Выровнять вид» (ui/view-align.js)
  state.ghostDoor = null;
  state.ghostLandscape = null;
  state.guides = [];
  state.objGuides = null;
  state.elevEdit = null;
  if (!el('calOverlay').hidden) el('calOverlay').hidden = true;
  if (!el('elevOverlay').hidden) el('elevOverlay').hidden = true;
  setHint('');
  renderLibrary();
  renderSelectionToolbar();
  if (wasOpening) renderProps();
  if (wasOpening) document.dispatchEvent(new CustomEvent('kepler:opening-tool'));
  requestDraw();
}

export function startFurnitureMove() {
  if (state.editLocked || state.modeName !== 'plan') return;
  const sel = state.selection;
  const ids = sel?.type === 'item' ? [sel.id]
    : sel?.type === 'multi' && !sel.roomIds?.length && !sel.wallIds?.length ? sel.itemIds : [];
  if (!ids.length || ids.some((id) => !state.project.items.some((item) => item.id === id))) return;
  state.itemHandle = null;
  closeLibrarySheet();
  setTool({ kind: 'move-furniture', itemIds: [...ids], stage: 'pick' },
    'Нажмите на мебель в точке захвата, затем нажмите в новом месте · Esc — отмена');
  canvas.style.cursor = 'crosshair';
}

export function startPlaceRoom(type) {
  closeLibrarySheet(); // телефон: освободить план для касания
  setTool({ kind: 'place-room', type, rotation: 0 }, `Кликните на плане, чтобы разместить «${roomType(type).title}» — помещение встанет по текущему повороту вида · Пробел — повернуть · Esc — отмена`);
  state.selection = null;
  renderProps();
}

export function openingPlacementHint(tool) {
  if (isGlazedAssembly(tool.preset)) return 'Поставьте дверь на стену. Окна слева и справа включаются в свойствах.';
  if (tool.preset?.presetId === 'corner-glazing') return 'Нажмите на наружную стену у нужного угла, чтобы поставить оба крыла витража';
  return tool.openKind === 'door'
    ? 'Кликайте по стенам — можно ставить несколько дверей · Пробел — петли / направление · Esc — выход'
    : 'Кликайте по стенам и перегородкам — можно ставить несколько окон · Esc — выход';
}

export function startPlaceOpening(openKind, presetWall = null) {
  // Параметры (тип, размеры) задаются в «Свойствах» до вставки и помнятся.
  const preset = state.openingPreset[openKind] || (state.openingPreset[openKind] = defaultOpeningPreset(openKind));
  state.selection = null;
  const tool = { kind: 'place-opening', openKind, presetWall, hingeStart: true, preset };
  setTool(tool, openingPlacementHint(tool));
  renderProps();
  document.dispatchEvent(new CustomEvent('kepler:opening-tool'));
}

export function startPlaceFurniture(kind, title = 'мебель', options = {}) {
  closeLibrarySheet();
  setTool({ kind: 'place-furniture', itemKind: kind, rotation: 0, ...options },
    `Двигайте по плану и кликните, чтобы поставить «${title}» · Пробел — повернуть · Esc — отмена`);
  state.selection = null;
  renderProps();
}

// Пробел во время размещения меняет предпросмотр, а не включает панораму.
export function rotatePlacementPreview() {
  const tool = state.tool;
  if (!tool) return false;
  if (tool.kind === 'place-furniture') {
    tool.rotation = ((tool.rotation || 0) + 90) % 360;
    if (state.ghostItem) state.ghostItem.rotation = tool.rotation;
  } else if (tool.kind === 'place-room') {
    tool.rotation = ((tool.rotation || 0) + 90) % 360;
    if (state.ghost?.rect) {
      const rect = state.ghost.rect;
      const cx = rect.x + rect.w / 2;
      const cy = rect.y + rect.h / 2;
      [rect.w, rect.h] = [rect.h, rect.w];
      rect.x = cx - rect.w / 2;
      rect.y = cy - rect.h / 2;
    }
  } else if (tool.kind === 'place-opening' && (tool.openKind === 'door' || isGlazedAssembly(tool.preset))) {
    // Пробел — только петли слева/справа; сторона открывания идёт за курсором.
    tool.hingeStart = tool.hingeStart === false;
    if (state.ghostDoor) state.ghostDoor.hingeStart = tool.hingeStart;
  } else return false;
  requestDraw();
  return true;
}

export function startDraw(target) {
  const names = { boundary: 'границу участка', redline: 'красную линию', road: 'ось дороги' };
  const finish = target === 'boundary'
    ? 'клик по первой точке или Enter — замкнуть'
    : 'двойной клик или Enter — завершить';
  setTool({ kind: 'draw', target }, `Кликами наметьте ${names[target]} · ${finish} · Shift — без привязки, F8 — орто, число + Enter — длина · Esc — отмена`);
  // В режиме участка без инструмента используется курсор-панорама («рука»).
  // Сбрасываем его сразу при включении черчения, не дожидаясь движения мыши.
  canvas.style.cursor = 'crosshair';
  state.draft = { kind: target, points: [], cursor: null, closeHint: target === 'boundary' };
}

// Включить правку существующего слоя (вершины/перемещение) — объект выделяется.
export function startEditLayer(target, selection, hint) {
  setTool({ kind: 'edit', target }, hint);
  selectObject(selection);
}

// Какой слой участка сейчас редактируется (по активному инструменту).
export function activeSiteLayer() {
  const t = state.tool;
  if (!t) return null;
  if (t.kind === 'underlay-edit') return 'underlay';
  if (t.kind === 'entry') return 'entry';
  if (t.kind === 'neighbor') return 'neighbor';
  if (t.kind === 'terrain') return 'terrain';
  if (t.kind === 'draw' || t.kind === 'edit') return t.target;
  return null;
}

// Единая контекстная панель действий над выделением — одно и то же место
// для комнат, стен, проёмов, мебели и групп, как в BIM-редакторах.

import { isOpenRoom, isShaft } from '../core/catalog.js';
import { wallsInsideRooms } from '../core/bound-rooms.js';
import { canFill } from '../core/landscape-array.js';
import { roomById } from '../core/model.js';
import { planGapStretch, planGapThicken } from '../core/gap-fix.js';
import { planGapMove } from '../core/gaps.js';
import { railingTypeTitle } from '../core/railings.js';
import { overhangLabel } from '../core/roofs.js';
import { findSlabOpening, slabOpeningStair } from '../core/slab-openings.js';
import { selectedRailing } from './railing-actions.js';
import { el, escapeHtml } from './dom.js';
import { findWall } from './hit.js';
import { state } from './state.js';
import { activeGrids } from './plan-grids.js';
import { wallPins } from '../core/grid-pins.js';
import { visibleRoofById } from './plan-roofs.js';
import { allMasses } from '../core/masses.js';

const button = (action, icon, text, key = '', extra = '') => `
  <button type="button" data-selection-action="${action}" ${extra} title="${escapeHtml(text)}${key ? ` (${key})` : ''}">
    <span class="tool-icon" aria-hidden="true">${icon}</span>
    <span class="tool-text">${escapeHtml(text)}</span>
    ${key ? `<span class="tool-key">${key}</span>` : ''}
  </button>`;

// Пара с зазором «≠ N мм», выбранная по маркеру или строке «Замечаний» (как focusedGap в ui/gaps.js;
// здесь без импорта — иначе круг модулей).
function gapOfSelection(sel) {
  const gap = (state.gaps || []).find((g) => g.key === state.gapFocus);
  return gap && sel.roomIds.includes(gap.a) && sel.roomIds.includes(gap.b) ? gap : null;
}

const mmText = (v) => `${Math.round(Math.abs(v))} мм`;

// Три способа исправить зазор (core/gap-fix.js); у каждого в подсказке — что именно изменится.
function gapButtons(gap) {
  const project = state.project;
  const move = planGapMove(project, gap).move;
  const stretch = planGapStretch(project, gap);
  const thick = planGapThicken(project, gap);
  const off = (reason) => `disabled title="Нельзя: ${escapeHtml(reason)}"`;
  const moveReason = planGapMove(project, gap).reason;
  return `
    <button type="button" data-selection-action="gap-move" ${move ? `title="Сдвинуть «${escapeHtml(move.name)}» на ${mmText(move.distance)}: комната едет целиком"` : off(moveReason || 'сдвиг невозможен')}>
      <span class="tool-icon" aria-hidden="true">⇥</span><span class="tool-text">Сдвинуть</span>
    </button>
    <button type="button" data-selection-action="gap-stretch" ${stretch.move ? `title="${stretch.move.direction === 'out' ? 'Продлить' : 'Сузить'} сторону «${escapeHtml(stretch.move.name)}» на ${mmText(stretch.move.distance)}: остальные стороны на месте"` : off(stretch.reason || 'растяжение невозможно')}>
      <span class="tool-icon" aria-hidden="true">⇔</span><span class="tool-text">Растянуть</span>
    </button>
    <button type="button" data-selection-action="gap-thicken" ${thick.thickness != null ? `title="Оставить комнаты на месте: щель станет общей стеной ${thick.thickness} мм"` : off(thick.reason || 'нельзя')}>
      <span class="tool-icon" aria-hidden="true">▮</span><span class="tool-text">${thick.thickness != null ? `Стена ${thick.thickness}` : 'Стена'}</span>
    </button>`;
}

function itemCanMirror(item) {
  return Boolean(item);
}

// «Прикрепить к оси» / «Открепить от оси» (core/grid-pins.js): есть
// параллельная ось — кнопка; дублирует замок на плане.
function gridPinButton(wall) {
  if (!wall || (wall.orient !== 'h' && wall.orient !== 'v')) return '';
  const pinned = wallPins(state.project, wall).length > 0;
  if (pinned) return button('grid-unpin', '⊸', 'Открепить от оси');
  const kind = wall.orient === 'h' ? 'y' : 'x';
  return activeGrids().some((g) => g.kind === kind) ? button('grid-pin', '⊸', 'Прикрепить к оси') : '';
}

function contentForSelection(sel) {
  if (sel.type === 'room') {
    const room = roomById(state.project, sel.id);
    if (!room) return null;
    const common = `${button('duplicate', '⧉', 'Копировать', 'Ctrl+D')}${room.parentId ? '' : button('rotate', '↻', 'Повернуть 90°', 'R')}`;
    const atrium = isShaft(room) || isOpenRoom(room) ? '' : button('atrium', '⇳', 'Второй свет');
    const roomTools = isShaft(room) ? '' : `${button('add-door', '◱', 'Дверь')}${button('add-window', '▦', 'Окно')}${button('roof', '⌂', 'Крыша', 'K')}`;
    return { label: isShaft(room) ? 'Шахта' : 'Помещение', html: `${atrium}${common}${roomTools}${button('delete', '⌫', 'Удалить', 'Del', 'class="danger"')}` };
  }
  if (sel.type === 'wall') {
    const wall = findWall(sel.key, sel.from);
    if (!wall) return null;
    if (wall.kind === 'manual') {
      const divides = wallsInsideRooms(state.project).find((q) => q.wallId === wall.wallId && q.divides);
      const openingDisabled = wall.orient === 'a' ? 'disabled title="Проёмы в косой стене пока недоступны"' : '';
      return {
        label: 'Стена (ручная)',
        html: `${button('hide-wall', wall.hidden ? '▣' : '◫', wall.hidden ? 'Показать стену' : 'Скрыть стену')}
          ${button('add-door', '◱', 'Дверь', '', openingDisabled)}
          ${button('add-window', '▦', 'Окно', '', openingDisabled)}
          ${divides ? button('split-room', '⊟', 'Разделить на два', '', `data-room="${divides.roomId}"`) : ''}
          ${gridPinButton(wall)}
          ${button('delete', '⌫', 'Удалить', 'Del', 'class="danger"')}`,
      };
    }
    const canSplit = wall.kind === 'own' || wall.kind === 'shared'; // общая — в обеих комнатах
    return {
      label: 'Стена',
      html: `${button('split-wall', '⌜', 'Разделить', '', canSplit ? '' : 'disabled')}
        ${button('hide-wall', wall.hidden ? '▣' : '◫', wall.hidden ? 'Показать стену' : 'Скрыть стену')}
        ${button('add-door', '◱', 'Дверь')}
        ${button('add-window', '▦', 'Окно')}
        ${gridPinButton(wall)}`,
    };
  }
  if (sel.type === 'grid') {
    const g = (state.project.grids || []).find((x) => x.id === sel.id);
    if (!g) return null;
    return {
      label: `Ось ${g.label} · ${g.kind} = ${Math.round(g.at)} мм`,
      html: `${button('grid-rename', '✎', 'Переименовать')}${button('delete', '⌫', 'Удалить', 'Del', 'class="danger"')}`,
    };
  }
  if (sel.type === 'mass') {
    const mass = allMasses(state.project).find((m) => m.id === sel.id);
    if (!mass) return null;
    return {
      label: `${mass.id.startsWith('void-') ? 'Полая масса · ' : ''}${mass.name} · ${Math.round(mass.w)} × ${Math.round(mass.d)} × ${Math.round(mass.h)} мм`,
      html: `${button('duplicate', '⧉', 'Копировать', 'Ctrl+D')}${button('rotate', '↻', 'Повернуть 90°', 'R')}${button('delete', '⌫', 'Удалить', 'Del', 'class="danger"')}`,
    };
  }
  if (sel.type === 'roof') {
    const roof = visibleRoofById(sel.id);
    if (!roof) return null;
    return {
      label: roof.roofSource === 'linked' ? roof.name : `${roof.name} · ${overhangLabel(roof)} мм`,
      html: `${state.roofPlan ? '' : button('roof-plan', '⌂', 'План крыши')}${button('delete', '⌫', 'Удалить', 'Del', 'class="danger"')}`,
    };
  }
  if (sel.type === 'railing') {
    const hit = selectedRailing(sel);
    if (!hit) return null;
    return {
      label: `Перила · ${railingTypeTitle(hit.seg.type).toLowerCase()} · ${Math.round(hit.seg.to - hit.seg.from)} мм`,
      html: `${button('railing-type', '◇', 'Тип')}
        ${button('railing-split', '⌜', 'Разделить')}
        ${button('delete', '⌫', 'Удалить', 'Del', 'class="danger"')}`,
    };
  }
  if (sel.type === 'opening') {
    const opening = state.project.openings.find((candidate) => candidate.id === sel.id);
    if (!opening) return null;
    const door = opening.kind === 'door';
    const canFlip = door && ['single', 'double', undefined].includes(opening.type);
    return {
      label: door ? 'Дверь' : 'Окно',
      html: `${button('duplicate', '⧉', 'Копировать', 'Ctrl+D')}
        ${canFlip ? button('flip-hinge', '⇆', 'Петли') + button('flip-swing', '↷', 'Открывание') : ''}
        ${button('delete', '⌫', 'Удалить', 'Del', 'class="danger"')}`,
    };
  }
  if (sel.type === 'item') {
    const item = state.project.items.find((candidate) => candidate.id === sel.id);
    if (!item) return null;
    const mirror = button('mirror', '⇋', 'Зеркально', 'M');
    const stair = item.kind === 'stairs' ? button('reverse-stair', '↕', 'Развернуть подъём') : '';
    return {
      label: item.kind === 'stairs' ? 'Лестница' : 'Мебель',
      html: `${button('move-furniture', '✥', 'Переместить')}${button('duplicate', '⧉', 'Копировать', 'Ctrl+D')}
        ${button('rotate', '↻', 'Повернуть 90°', 'R')}${mirror}${stair}
        ${button('delete', '⌫', 'Удалить', 'Del', 'class="danger"')}`,
    };
  }
  if (sel.type === 'multi') {
    const items = sel.itemIds.map((id) => state.project.items.find((candidate) => candidate.id === id)).filter(Boolean);
    const onlyItems = items.length > 0 && sel.roomIds.length === 0 && !sel.wallIds?.length;
    const groups = new Set(items.map((item) => item.group).filter(Boolean));
    const grouped = items.length >= 2 && groups.size === 1 && items.every((item) => item.group);
    const canMirror = onlyItems && items.every(itemCanMirror);
    // Группа с помещениями: копия, поворот вокруг центра группы, удаление.
    const canMove = onlyItems || sel.roomIds.length > 0 || sel.wallIds?.length > 0;
    const gap = sel.roomIds.length === 2 && !sel.itemIds.length && !sel.wallIds?.length ? gapOfSelection(sel) : null;
    if (gap) {
      return { label: `Зазор ${Math.round(gap.gap)} мм (нужно ${gap.target})`, html: gapButtons(gap) };
    }
    return {
      label: `Выбрано: ${sel.roomIds.length + sel.itemIds.length + (sel.wallIds?.length || 0)}`,
      html: `${onlyItems ? button('move-furniture', '✥', 'Переместить') : ''}${canMove ? button('duplicate', '⧉', 'Копировать', 'Ctrl+D') : ''}
        ${canMove ? button('rotate', '↻', 'Повернуть 90°', 'R') : ''}
        ${onlyItems ? button('mirror', '⇋', 'Зеркально', 'M', canMirror ? '' : 'disabled') : ''}
        ${items.length >= 2 ? button(grouped ? 'ungroup' : 'group', grouped ? '⊘' : '⊞', grouped ? 'Разгруппировать' : 'Сгруппировать') : ''}
        ${button('delete', '⌫', 'Удалить', 'Del', 'class="danger"')}`,
    };
  }
  if (sel.type === 'landscape') {
    const many = sel.ids.length > 1;
    // «Разорвать» — дорожка на отдельные плиты/доски/участки (как EXPLODE).
    const ids = new Set(sel.ids);
    const chosen = (state.project.site?.landscape?.objects || []).filter((o) => ids.has(o.id));
    const paths = chosen.filter((o) => o.kind === 'path' && !o.locked);
    // «Засадить» — один газон/клумба/короб; «Массив» — копии рядом, по кругу, по линии.
    const fillable = !many && chosen.length === 1 && canFill(chosen[0]) && !chosen[0].locked;
    return {
      label: many ? `Выбрано: ${sel.ids.length}` : 'Ландшафт',
      html: `${button('duplicate', '⧉', 'Копировать', 'Ctrl+D')}
        ${button('rotate', '↻', 'Повернуть 90°', 'R')}
        ${chosen.some((o) => !o.locked) ? button('array', '⁙', 'Массив', 'Shift+A') : ''}
        ${fillable ? button('plant-fill', '✿', 'Засадить') : ''}
        ${paths.length ? button('explode', '⁂', 'Разорвать', 'X') : ''}
        ${chosen.some((o) => o.kind !== 'callout') ? button('callout', '✎', 'Подписать', 'T') : ''}
        ${button('delete', '⌫', 'Удалить', 'Del', 'class="danger"')}`,
    };
  }
  if (sel.type === 'slab') {
    // Проём в перекрытии (ui/slab-ui.js): ручной — «Вернуть авто» и удаление.
    const o = findSlabOpening(state.project, sel.levelId || state.project.activeLevel, sel.id);
    if (!o) return null;
    const canReset = !o.auto && o.stairId && slabOpeningStair(state.project, o);
    return {
      label: `${o.atrium ? 'Второй свет' : 'Проём в перекрытии'} · ${o.w} × ${o.h} мм${o.auto ? ' · по лестнице' : ''}`,
      html: `${canReset ? button('slab-auto', '↺', 'Вернуть авто') : ''}${o.auto ? '' : button('delete', '⌫', 'Удалить', 'Del', 'class="danger"')}`,
    };
  }
  if (sel.type === 'section') {
    const view = (state.project.views || []).find((v) => v.id === sel.id);
    if (!view) return null;
    return {
      label: view.name,
      html: `${button('open-section', '▣', 'Открыть вид')}
        ${button('flip-section', '⇄', 'Развернуть')}
        ${button('delete', '⌫', 'Удалить', 'Del', 'class="danger"')}`,
    };
  }
  if (sel.type === 'site' && sel.kind === 'building') {
    return { label: 'Дом: тяните мышью или стрелками', html: '' };
  }
  if (sel.type === 'site') {
    return { label: 'Объект участка', html: button('delete', '⌫', 'Удалить', 'Del', 'class="danger"') };
  }
  return null;
}

export function renderSelectionToolbar() {
  const panel = el('selectionToolbar');
  if (!panel) return;
  if (state.tool?.kind !== 'atrium') el('atriumPanel').hidden = true;
  if (state.tool?.kind === 'move-furniture') {
    panel.innerHTML = `<span class="selection-toolbar-label">${state.tool.stage === 'pick' ? 'Нажмите на мебель' : 'Укажите новое место'}</span>
      ${button('cancel-move', '×', 'Отмена', 'Esc')}`;
    panel.hidden = false;
    return;
  }
  const content = state.selection && !state.tool ? contentForSelection(state.selection) : null;
  if (!content) { panel.hidden = true; panel.innerHTML = ''; return; }
  panel.innerHTML = `<span class="selection-toolbar-label" title="${escapeHtml(content.label)}">${escapeHtml(content.label)}</span>
    <span class="selection-toolbar-group">${content.html}</span>`;
  panel.hidden = false;
}

export function bindSelectionToolbar() {
  el('v3Atrium')?.addEventListener('click', async () => (await import('./atrium-ui.js')).startAtrium());
  // Модули грузим заранее: иначе первый клик выполняется с задержкой загрузки.
  const actionsReady = import('./plan-actions.js');
  const toolsReady = import('./tools.js');
  el('selectionToolbar')?.addEventListener('click', async (event) => {
    const target = event.target.closest('[data-selection-action]');
    if (!target || target.disabled) return;
    const action = target.dataset.selectionAction;
    if (action === 'move-furniture' || action === 'cancel-move') {
      const tools = await toolsReady;
      if (action === 'move-furniture') tools.startFurnitureMove(); else tools.cancelTool();
      return;
    }
    if (state.selection?.type === 'landscape') {
      const ls = await import('./landscape.js');
      if (action === 'duplicate') ls.duplicateLandscapeSelection();
      else if (action === 'rotate') ls.rotateLandscape90();
      else if (action === 'delete') ls.deleteLandscapeSelection();
      else if (action === 'explode') ls.explodeLandscapeSelection();
      else if (action === 'callout') ls.labelLandscapeSelection();
      else if (action === 'array' || action === 'plant-fill') {
        const la = await import('./landscape-array.js');
        if (action === 'array') la.startLandscapeArray(); else la.plantFillSelection();
      }
      return;
    }
    if (action.startsWith('gap-')) {
      const sel = state.selection;
      const gap = sel?.type === 'multi' ? gapOfSelection(sel) : null;
      if (gap) (await actionsReady).applyGapFix(gap, action.slice(4));
      return;
    }
    if (action === 'atrium') {
      (await import('./atrium-ui.js')).startAtrium();
      return;
    }
    if (action === 'slab-auto') {
      (await import('./slab-ui.js')).resetSlabAuto();
      return;
    }
    if (action === 'open-section' || action === 'flip-section') {
      const id = state.selection?.id;
      if (action === 'open-section') (await import('./elevation-view.js')).openElevation(id);
      else (await import('./plan-section.js')).flipSectionView(id);
      return;
    }
    if (action === 'grid-pin' || action === 'grid-unpin') {
      const gp = await import('./grid-pin-ui.js');
      if (action === 'grid-pin') gp.pinSelectedWall(); else gp.unpinSelectedWall();
      return;
    }
    if (action === 'grid-rename') {
      (await import('./grids.js')).focusGridLabel();
      return;
    }
    if (action === 'railing-type' || action === 'railing-split') {
      const ra = await import('./railing-actions.js');
      if (action === 'railing-type') ra.cycleSelectedRailingType(); else ra.splitSelectedRailing();
      return;
    }
    if (action === 'roof' || action === 'roof-plan') {
      const rf = await import('./roofs.js');
      if (action === 'roof') rf.coverSelectedRoom(); else rf.showRoofPlan(state.selection?.id);
      (await import('./toolstrip.js')).renderToolstrip();
      return;
    }
    if (action === 'split-room') {
      const wt = await import('./wall-tool.js');
      const sel = state.selection;
      if (sel?.type === 'wall') wt.splitByWallAction(target.dataset.room, sel.key.slice(2));
      return;
    }
    const actions = await actionsReady;
    if (action === 'duplicate') actions.duplicateSelection();
    else if (action === 'rotate') actions.rotateSelection90();
    else if (action === 'mirror') actions.mirrorSelection();
    else if (action === 'delete') actions.deleteSelection();
    else if (action === 'split-wall') actions.splitSelectedWall();
    else if (action === 'hide-wall') actions.toggleSelectedWallHidden();
    else if (action === 'flip-hinge') actions.flipSelectedOpening('hinge');
    else if (action === 'flip-swing') actions.flipSelectedOpening('swing');
    else if (action === 'reverse-stair') actions.reverseSelectedStair();
    else if (action === 'group') actions.groupSelectedItems();
    else if (action === 'ungroup') actions.ungroupSelectedItems();
    else if (action === 'add-door' || action === 'add-window') {
      const { startPlaceOpening } = await toolsReady;
      const sel = state.selection;
      const preset = sel?.type === 'wall' ? { key: sel.key, from: sel.from } : null;
      startPlaceOpening(action === 'add-door' ? 'door' : 'window', preset);
    }
  });
}

// Единая контекстная панель действий над выделением — одно и то же место
// для комнат, стен, проёмов, мебели и групп, как в BIM-редакторах.

import { isShaft } from '../core/catalog.js';
import { wallsInsideRooms } from '../core/bound-rooms.js';
import { canFill } from '../core/landscape-array.js';
import { roomById } from '../core/model.js';
import { railingTypeTitle } from '../core/railings.js';
import { selectedRailing } from './railing-actions.js';
import { el, escapeHtml } from './dom.js';
import { findWall } from './hit.js';
import { state } from './state.js';

const button = (action, icon, text, key = '', extra = '') => `
  <button type="button" data-selection-action="${action}" ${extra} title="${escapeHtml(text)}${key ? ` (${key})` : ''}">
    <span class="tool-icon" aria-hidden="true">${icon}</span>
    <span class="tool-text">${escapeHtml(text)}</span>
    ${key ? `<span class="tool-key">${key}</span>` : ''}
  </button>`;

function itemCanMirror(item) {
  return Boolean(item);
}

function contentForSelection(sel) {
  if (sel.type === 'room') {
    const room = roomById(state.project, sel.id);
    if (!room) return null;
    const common = `${button('duplicate', '⧉', 'Копировать', 'Ctrl+D')}${room.parentId ? '' : button('rotate', '↻', 'Повернуть 90°', 'R')}`;
    const roomTools = isShaft(room) ? '' : `${button('add-door', '◱', 'Дверь')}${button('add-window', '▦', 'Окно')}`;
    return { label: isShaft(room) ? 'Шахта' : 'Помещение', html: `${common}${roomTools}${button('delete', '⌫', 'Удалить', 'Del', 'class="danger"')}` };
  }
  if (sel.type === 'wall') {
    const wall = findWall(sel.key, sel.from);
    if (!wall) return null;
    if (wall.kind === 'manual') {
      const divides = wallsInsideRooms(state.project).find((q) => q.wallId === wall.wallId && q.divides);
      return {
        label: 'Стена (ручная)',
        html: `${button('hide-wall', wall.hidden ? '▣' : '◫', wall.hidden ? 'Показать стену' : 'Скрыть стену')}
          ${button('add-door', '◱', 'Дверь')}
          ${button('add-window', '▦', 'Окно')}
          ${divides ? button('split-room', '⊟', 'Разделить на два', '', `data-room="${divides.roomId}"`) : ''}
          ${button('delete', '⌫', 'Удалить', 'Del', 'class="danger"')}`,
      };
    }
    const room = roomById(state.project, wall.rooms[0]);
    const canSplit = wall.kind === 'own' || wall.kind === 'shared'; // общая — в обеих комнатах
    const canWindow = wall.kind !== 'shared' && !room?.parentId;
    return {
      label: 'Стена',
      html: `${button('split-wall', '⌜', 'Разделить', '', canSplit ? '' : 'disabled')}
        ${button('hide-wall', wall.hidden ? '▣' : '◫', wall.hidden ? 'Показать стену' : 'Скрыть стену')}
        ${button('add-door', '◱', 'Дверь')}
        ${button('add-window', '▦', 'Окно', '', canWindow ? '' : 'disabled')}`,
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
    const mass = (state.project.masses || []).find((m) => m.id === sel.id);
    if (!mass) return null;
    return {
      label: `${mass.name} · ${Math.round(mass.w)} × ${Math.round(mass.d)} × ${Math.round(mass.h)} мм`,
      html: `${button('duplicate', '⧉', 'Копировать', 'Ctrl+D')}${button('rotate', '↻', 'Повернуть 90°', 'R')}${button('delete', '⌫', 'Удалить', 'Del', 'class="danger"')}`,
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
      html: `${button('duplicate', '⧉', 'Копировать', 'Ctrl+D')}
        ${button('rotate', '↻', 'Повернуть 90°', 'R')}${mirror}${stair}
        ${button('delete', '⌫', 'Удалить', 'Del', 'class="danger"')}`,
    };
  }
  if (sel.type === 'multi') {
    const items = sel.itemIds.map((id) => state.project.items.find((candidate) => candidate.id === id)).filter(Boolean);
    const onlyItems = items.length > 0 && sel.roomIds.length === 0;
    const groups = new Set(items.map((item) => item.group).filter(Boolean));
    const grouped = items.length >= 2 && groups.size === 1 && items.every((item) => item.group);
    const canMirror = onlyItems && items.every(itemCanMirror);
    // Группа с помещениями: копия, поворот вокруг центра группы, удаление.
    const canMove = onlyItems || sel.roomIds.length > 0;
    return {
      label: `Выбрано: ${sel.roomIds.length + sel.itemIds.length}`,
      html: `${canMove ? button('duplicate', '⧉', 'Копировать', 'Ctrl+D') : ''}
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
  const content = state.selection && !state.tool ? contentForSelection(state.selection) : null;
  if (!content) { panel.hidden = true; panel.innerHTML = ''; return; }
  panel.innerHTML = `<span class="selection-toolbar-label" title="${escapeHtml(content.label)}">${escapeHtml(content.label)}</span>
    <span class="selection-toolbar-group">${content.html}</span>`;
  panel.hidden = false;
}

export function bindSelectionToolbar() {
  // Модули грузим заранее: иначе первый клик выполняется с задержкой загрузки.
  const actionsReady = import('./plan-actions.js');
  const toolsReady = import('./tools.js');
  el('selectionToolbar')?.addEventListener('click', async (event) => {
    const target = event.target.closest('[data-selection-action]');
    if (!target || target.disabled) return;
    const action = target.dataset.selectionAction;
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
    if (action === 'open-section' || action === 'flip-section') {
      const id = state.selection?.id;
      if (action === 'open-section') (await import('./elevation-view.js')).openElevation(id);
      else (await import('./plan-section.js')).flipSectionView(id);
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

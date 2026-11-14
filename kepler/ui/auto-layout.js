// Интерфейс многовариантной авторасстановки мебели.
//
// Поиск никогда не меняет проект: варианты лежат в эфемерном кеше
// state.layoutVariants. Проект меняется только по кнопке «Применить» через
// store.mutate(), поэтому вся расстановка отменяется одним Ctrl+Z.
// Автоматическая перестройка после изменения формы вызывается редактором
// через arrangeRoomsNow(); эта функция намеренно не создаёт историю сама.

import {
  applyFurnitureLayout, generateFurnitureLayouts, validateFurnitureLayout,
} from '../core/autolayout.js';
import { defaultItemsFor, itemsInRoom } from '../core/furnish.js';
import { projectToLayoutInput } from '../core/layout-contract.js';
import { cloneProject, levelProject, roomById } from '../core/model.js';
import { deriveWalls } from '../core/walls.js';
import { escapeHtml, toast } from './dom.js';
import { state } from './state.js';

const COUNT = 3;

function cache() {
  // Старое состояние страницы может жить во вкладке во время обновления
  // модулей. Ленивая инициализация не ломает такие сессии и тесты ядра.
  if (!(state.layoutVariants instanceof Map)) state.layoutVariants = new Map();
  return state.layoutVariants;
}

const cleanNumber = (value) => (Number.isFinite(Number(value)) ? Math.round(Number(value) * 1000) / 1000 : null);

function itemSignature(item) {
  return {
    id: item.id,
    kind: item.kind,
    x: cleanNumber(item.x), y: cleanNumber(item.y),
    w: cleanNumber(item.w), h: cleanNumber(item.h),
    rotation: cleanNumber(item.rotation || 0),
    comp: item.comp || null,
    autoLayoutLocked: item.autoLayoutLocked === true,
  };
}

// Сигнатура только тех данных, которые влияют на расстановку. Она не даёт
// применить вариант после правки комнаты, проёма или мебели.
export function layoutSignature(project, room) {
  if (!project || !room) return '';
  const children = project.rooms
    .filter((candidate) => candidate.parentId === room.id)
    .map((candidate) => ({
      id: candidate.id, x: candidate.x, y: candidate.y, w: candidate.w, h: candidate.h,
      outline: candidate.outline || null, notch: candidate.notch || null,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const openings = (project.openings || []).map((opening) => ({
    id: opening.id, kind: opening.kind, roomId: opening.roomId || null,
    host: opening.host || null, side: opening.side ?? null, offset: opening.offset ?? null,
    width: opening.width ?? null, height: opening.height ?? null, sill: opening.sill ?? null,
    hingeStart: opening.hingeStart ?? null, swingIn: opening.swingIn ?? null,
  })).sort((a, b) => a.id.localeCompare(b.id));
  const manualWalls = (project.walls || []).map((wall) => ({
    id: wall.id,
    axis: wall.axis || null,
    thickness: wall.thickness ?? null,
    justify: wall.justify || null,
    hidden: wall.hidden === true,
    roomBounding: wall.roomBounding !== false,
  })).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const solarContext = {
    building: project.building || null,
    settings: {
      exterior: project.settings?.exterior ?? null,
      wallsEngine: project.settings?.wallsEngine || null,
    },
    site: {
      north: project.site?.north ?? null,
      location: project.site?.location || null,
      solarVerified: project.site?.solarVerified === true,
      sun: project.site?.sun || null,
      norms: project.site?.norms || null,
      boundary: project.site?.boundary || null,
      neighbors: project.site?.neighbors || [],
    },
    levels: (project.levels || []).map((level) => ({
      id: level.id, elevation: level.elevation, height: level.height,
      rooms: level.rooms,
      openings: (level.openings || []).filter((opening) => opening.kind === 'window'),
      walls: level.walls || [],
      wallOverrides: level.wallOverrides || {},
    })),
  };
  const items = itemsInRoom(project, room).map(itemSignature).sort((a, b) => a.id.localeCompare(b.id));
  return JSON.stringify({
    room: {
      id: room.id, type: room.type, x: room.x, y: room.y, w: room.w, h: room.h,
      outline: room.outline || null, notch: room.notch || null, eatBase: room.eatBase || null,
    },
    children, openings, manualWalls, items, solarContext,
    partition: project.settings?.partition || 100,
  });
}

function layoutItems(project, room, itemIds = null) {
  if (itemIds == null) return itemsInRoom(project, room);
  const wanted = new Set(itemIds);
  return project.items.filter((item) => wanted.has(item.id));
}

function lockedIds(project, room, itemIds = null) {
  return layoutItems(project, room, itemIds).filter((item) => item.autoLayoutLocked === true).map((item) => item.id);
}

function seededTask(project, room) {
  const existing = itemsInRoom(project, room);
  if (existing.length) return { project, room, walls: state.walls, seedItems: [] };
  const seedItems = defaultItemsFor(room);
  if (!seedItems.length) return { project, room, walls: state.walls, seedItems: [] };
  // Пустая комната получает типовой набор только в копии. В настоящий проект
  // он попадёт вместе с выбранным вариантом, а не во время предпросмотра.
  const copy = cloneProject(project);
  const copyRoom = roomById(copy, room.id);
  copy.items.push(...seedItems.map((item) => structuredClone(item)));
  return { project: copy, room: copyRoom, walls: deriveWalls(copy), seedItems };
}

function findLayouts(project, room) {
  const signature = layoutSignature(project, room);
  const task = seededTask(project, room);
  const locked = task.seedItems.length ? [] : lockedIds(task.project, task.room);
  const result = generateFurnitureLayouts(task.project, task.room, task.walls, {
    count: COUNT,
    lockedIds: locked,
    beamWidth: 16,
    candidatesPerItem: 16,
    maxBasePoses: 72,
  });
  const input = projectToLayoutInput(task.project, { lockedItemIds: locked });
  const record = {
    signature,
    result,
    contractUnknowns: input.unknown_inputs.length,
    seedItems: task.seedItems.map((item) => structuredClone(item)),
  };
  cache().set(room.id, record);
  return record;
}

function activeRecord(room) {
  const record = cache().get(room.id);
  if (!record) return null;
  if (record.signature !== layoutSignature(state.project, room)) {
    cache().delete(room.id);
    return null;
  }
  return record;
}

const metric = (value, suffix = '') => (value == null ? '—' : `${Math.round(value).toLocaleString('ru-RU')}${suffix}`);

function checksSummary(layout) {
  if (layout.ruleSummary) {
    return {
      passed: layout.ruleSummary.byStatus?.pass || 0,
      failed: layout.ruleSummary.byStatus?.fail || 0,
      unknown: layout.ruleSummary.unknown || 0,
      hardUnknown: layout.ruleSummary.hardUnknown?.length || 0,
      known: layout.ruleSummary.known || 0,
      applicable: layout.ruleSummary.applicable || 0,
    };
  }
  const checks = layout.checks || [];
  const passed = checks.filter((check) => check.status === 'pass').length;
  const failed = checks.filter((check) => check.status === 'fail').length;
  const unknown = checks.filter((check) => check.status === 'unknown').length + (layout.unknowns?.length || 0);
  return { passed, failed, unknown, hardUnknown: 0, known: passed + failed, applicable: passed + failed + unknown };
}

function variantsHtml(record) {
  if (!record) return '<p class="empty-hint auto-layout-hint">Нажмите «Подобрать варианты» — проект пока не изменится.</p>';
  const { result } = record;
  if (result.status !== 'feasible' || !result.layouts?.length) {
    const diagnostics = result.diagnostics?.length ? result.diagnostics : ['Подходящий вариант не найден'];
    return `<div class="auto-layout-empty" role="status">
      <strong>Не удалось подобрать расстановку</strong>
      ${diagnostics.slice(0, 4).map((text) => `<p>${escapeHtml(text)}</p>`).join('')}
    </div>`;
  }
  const coverage = result.coverage || {};
  return `<div class="layout-variants" aria-label="Варианты расстановки">
    <p class="empty-hint auto-layout-coverage">Реестр первой группы: ${coverage.total || 0} правил${record.contractUnknowns ? ` · входов для уточнения: ${record.contractUnknowns}` : ''}</p>
    ${result.layouts.map((layout, index) => {
    const checks = checksSummary(layout);
    return `<article class="layout-variant" data-layout-variant="${escapeHtml(layout.id)}">
        <div class="layout-variant-head">
          <strong>${index + 1}. ${escapeHtml(layout.label || 'Вариант')}</strong>
          <span>${Math.round(layout.score || 0)} баллов</span>
        </div>
        <div class="layout-metrics">
          <span title="Проверка маршрута круглым телом диаметром 600 мм">Проверен проход ${metric(layout.metrics?.routeWidthMm, ' мм')}</span>
          <span title="Среднее перемещение мебели">Сдвиг ${metric(layout.metrics?.averageMoveMm, ' мм')}</span>
          <span>По расчётным данным ${checks.known} из ${checks.applicable} применимых</span>
          ${checks.failed ? `<span>Компромиссов: ${checks.failed}</span>` : ''}
          ${checks.unknown ? `<span>Пока неизвестны: ${checks.unknown}${checks.hardUnknown ? `, обязательных ${checks.hardUnknown}` : ''}</span>` : ''}
        </div>
        <button type="button" data-layout-apply="${escapeHtml(layout.id)}">Применить вариант</button>
      </article>`;
  }).join('')}
  </div>`;
}

export function autoLayoutHtml(room) {
  const record = activeRecord(room);
  const enabled = state.project?.settings?.autoArrangeFurniture !== false;
  return `<h3>Авторасстановка</h3>
    <div class="prop-block auto-layout-block">
      <label class="check-row">
        <input id="autoArrangeFurniture" type="checkbox" ${enabled ? 'checked' : ''}>
        <span>Перестраивать после изменения формы</span>
      </label>
      <button id="arrangeBtn" type="button">Подобрать ${COUNT} варианта</button>
      <div class="auto-layout-results" aria-live="polite">${variantsHtml(record)}</div>
    </div>`;
}

function putResults(panel, record) {
  const box = panel.querySelector('.auto-layout-results');
  if (box) box.innerHTML = variantsHtml(record);
}

function applyVariant(room, record, layout) {
  if (record.signature !== layoutSignature(state.project, room)) {
    invalidateLayoutVariants([room.id]);
    toast('Комната изменилась — подберите варианты заново', true);
    return;
  }
  // Валидация результата уже выполнялась ядром. Перед применением достаточно
  // проверить неизменность входа; mutate создаст ровно один снимок истории.
  import('./store.js').then(({ mutate }) => {
    if (record.signature !== layoutSignature(state.project, room)) {
      invalidateLayoutVariants([room.id]);
      toast('Комната изменилась — подберите варианты заново', true);
      return;
    }
    const validationProject = record.seedItems.length ? cloneProject(state.project) : state.project;
    if (record.seedItems.length) validationProject.items.push(...record.seedItems.map((item) => structuredClone(item)));
    const validationRoom = roomById(validationProject, room.id);
    const validationWalls = deriveWalls(validationProject);
    const validationLocked = lockedIds(validationProject, validationRoom);
    const validation = validateFurnitureLayout(validationProject, validationRoom, validationWalls, layout, {
      lockedIds: validationLocked,
    });
    if (!validation.ok) {
      invalidateLayoutVariants([room.id]);
      toast('Вариант больше не проходит проверку — подберите заново', true);
      return;
    }
    // Удаляем предпросмотр до mutate: его afterChange() сразу перерисует
    // свойства уже без устаревших карточек применённого решения.
    invalidateLayoutVariants([room.id]);
    mutate(() => {
      if (record.seedItems.length) {
        const present = new Set(state.project.items.map((item) => item.id));
        for (const item of record.seedItems) if (!present.has(item.id)) state.project.items.push(structuredClone(item));
      }
      applyFurnitureLayout(state.project, layout);
      state.rejected.set(room.id, []);
    });
    toast(`Применён вариант «${layout.label || 'Авторасстановка'}» · Ctrl+Z — отменить`);
  }).catch((error) => {
    console.error('Авторасстановка не применилась:', error);
    toast('Не удалось применить вариант', true);
  });
}

export function bindAutoLayout(panel, room) {
  if (!panel || !room) return;
  const arrange = panel.querySelector('#arrangeBtn');
  arrange?.addEventListener('click', () => {
    arrange.disabled = true;
    arrange.textContent = 'Подбираем…';
    // Сначала показать состояние кнопки, затем выполнить синхронный поиск.
    requestAnimationFrame(() => {
      try {
        const record = findLayouts(state.project, room);
        putResults(panel, record);
      } catch (error) {
        console.error('Авторасстановка не посчиталась:', error);
        putResults(panel, {
          result: { status: 'search_budget_exhausted', diagnostics: ['Ошибка расчёта — проект не изменён'], layouts: [] },
        });
      } finally {
        arrange.disabled = false;
        arrange.textContent = `Подобрать ${COUNT} варианта`;
      }
    });
  });

  panel.querySelector('#autoArrangeFurniture')?.addEventListener('change', (event) => {
    const checked = event.target.checked;
    import('./store.js').then(({ mutate }) => mutate(() => {
      state.project.settings.autoArrangeFurniture = checked;
    }));
  });

  panel.querySelector('.auto-layout-results')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-layout-apply]');
    if (!button) return;
    const record = activeRecord(room);
    const layout = record?.result.layouts?.find((candidate) => candidate.id === button.dataset.layoutApply);
    if (!record || !layout) {
      toast('Вариант устарел — подберите заново', true);
      return;
    }
    button.disabled = true;
    applyVariant(room, record, layout);
  });
}

// Автоперестройка для store/input: меняет текущий проект, но не вызывает
// mutate(), pushHistory() или afterChange(). Вызывающая сторона включает её
// в собственную транзакцию жеста/поля размера.
export function arrangeRoomsNow(roomIds, { force = false, itemIdsByRoom = null, levelId = null } = {}) {
  const rootProject = state.project;
  const reports = [];
  if (!rootProject || (!force && rootProject.settings?.autoArrangeFurniture === false)) return { applied: 0, reports };
  const targetLevelId = levelId || rootProject.activeLevel;
  const project = targetLevelId === rootProject.activeLevel ? rootProject : levelProject(rootProject, targetLevelId);
  const walls = targetLevelId === rootProject.activeLevel ? state.walls : deriveWalls(project);
  let applied = 0;
  for (const roomId of new Set(roomIds || [])) {
    const room = roomById(project, roomId);
    const included = itemIdsByRoom instanceof Map ? itemIdsByRoom.get(roomId) : itemIdsByRoom?.[roomId];
    if (!room || !layoutItems(project, room, included).length) continue;
    const locked = lockedIds(project, room, included);
    const result = generateFurnitureLayouts(project, room, walls, {
      count: 1,
      lockedIds: locked,
      itemIds: included,
      beamWidth: 8,
      candidatesPerItem: 8,
      maxBasePoses: 40,
    });
    const layout = result.layouts?.[0] || null;
    let accepted = false;
    if (layout) {
      const validation = validateFurnitureLayout(project, room, walls, layout, { lockedIds: locked, itemIds: included });
      if (validation.ok) {
        applied += applyFurnitureLayout(project, layout);
        accepted = true;
      }
      else result.diagnostics = [...(result.diagnostics || []), 'Независимая проверка отклонила лучший вариант'];
    }
    state.rejected.set(room.id, accepted
      ? []
      : (result.diagnostics?.length ? result.diagnostics : ['Подходящий вариант не найден']).map((reason) => ({ reason })));
    reports.push({ levelId: targetLevelId, roomId, result, layout: accepted ? layout : null });
    cache().delete(room.id);
  }
  return { applied, reports };
}

export function invalidateLayoutVariants(roomIds = null) {
  if (roomIds == null) { cache().clear(); return; }
  for (const roomId of roomIds) cache().delete(roomId);
}

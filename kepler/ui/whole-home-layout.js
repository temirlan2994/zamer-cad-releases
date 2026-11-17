// Фоновый подбор нескольких вариантов мебели сразу для всего дома.
// Результат хранится только как предпросмотр и применяется одной транзакцией
// Undo/Redo после повторной проверки сигнатуры исходного проекта.

import { applyWholeHomeLayout } from '../core/whole-home-layout.js';
import {
  normalizeLayoutScope, normalizeSearchBudget,
} from '../core/layout-protocol.js';
import {
  createSolverSnapshot, solverInputSignature,
} from '../core/solver-snapshot.js';
import {
  LayoutSolveCancelledError, LayoutWorkerClient, StaleLayoutResultError,
} from './layout-worker-client.js';
import { escapeHtml, toast } from './dom.js';
import { state } from './state.js';

const COUNT = 3;
const SCOPE = Object.freeze({ kind: 'project', levelId: null, roomId: null });
const OPTIONS = Object.freeze({
  count: COUNT,
  searchBudget: 20,
  maxVariants: COUNT,
  maxExpansions: 1500,
  seedEmptyRooms: true,
  roomOptions: {
    count: COUNT,
    beamWidth: 12,
    candidatesPerItem: 12,
    maxBasePoses: 56,
  },
});

const client = new LayoutWorkerClient();
let activeTask = null;
let progressText = '';

function currentSignature(project = state.project) {
  const snapshot = createSolverSnapshot(project);
  return solverInputSignature(
    snapshot,
    normalizeLayoutScope(SCOPE),
    normalizeSearchBudget(OPTIONS),
  );
}

function cache() {
  const record = state.wholeHomeLayoutVariants;
  if (!record) return null;
  try {
    if (record.inputSignature === currentSignature()) return record;
  } catch { /* повреждённый/сменившийся проект просто инвалидирует preview */ }
  state.wholeHomeLayoutVariants = null;
  return null;
}

function ruleCounts(variant) {
  const summaries = (variant.rooms || []).map((room) => room.validation?.ruleSummary).filter(Boolean);
  return summaries.reduce((total, summary) => ({
    known: total.known + (summary.known || 0),
    applicable: total.applicable + (summary.applicable || 0),
    unknown: total.unknown + (summary.unknown || 0),
    hardUnknown: total.hardUnknown + (summary.hardUnknown?.length || 0),
  }), { known: 0, applicable: 0, unknown: 0, hardUnknown: 0 });
}

function resultHtml(record) {
  if (!record) {
    const status = activeTask ? (progressText || 'Запускаем расчёт…') : 'Проект не изменится до выбора варианта.';
    return `<p class="empty-hint whole-home-hint">${escapeHtml(status)}</p>`;
  }
  const result = record.result;
  if (!result?.variants?.length) {
    const messages = result?.diagnostics?.length ? result.diagnostics : ['Полный вариант дома не найден'];
    return `<div class="auto-layout-empty" role="status">
      <strong>${result?.status === 'cancelled' ? 'Расчёт отменён' : 'Не удалось собрать весь дом'}</strong>
      ${messages.slice(0, 5).map((message) => `<p>${escapeHtml(message)}</p>`).join('')}
    </div>`;
  }
  const scenarios = result.scenarioEvaluation?.summary;
  const scenarioHint = scenarios?.active
    ? ` · сценариев ${scenarios.active}, статус: ${scenarios.readiness === 'ready' ? 'проверены' : scenarios.readiness === 'failed' ? 'есть ошибка' : 'нужны данные'}`
    : '';
  return `<div class="whole-home-variants" aria-label="Варианты мебели всего дома">
    <p class="empty-hint">${result.summary.processedRooms} комнат · ${result.summary.seedItems} новых предметов${scenarioHint}</p>
    ${result.variants.map((variant, index) => {
    const rules = ruleCounts(variant);
    return `<article class="layout-variant" data-whole-home-variant="${escapeHtml(variant.id)}">
        <div class="layout-variant-head">
          <strong>${index + 1}. ${escapeHtml(variant.label)}</strong>
          <span>${Math.round(variant.score || 0)} баллов</span>
        </div>
        <div class="layout-metrics">
          <span>${variant.summary.rooms} комнат</span>
          <span>${variant.summary.items} предметов</span>
          <span>Рассчитано ${rules.known} из ${rules.applicable}</span>
          ${rules.unknown ? `<span>Неизвестно ${rules.unknown}${rules.hardUnknown ? ` · обязательных ${rules.hardUnknown}` : ''}</span>` : ''}
        </div>
        <button type="button" data-whole-home-apply="${escapeHtml(variant.id)}">Применить ко всему дому</button>
      </article>`;
  }).join('')}
  </div>`;
}

export function wholeHomeLayoutHtml() {
  const record = cache();
  return `<div class="whole-home-layout">
    <button id="arrangeWholeHomeBtn" type="button">${activeTask ? 'Отменить расчёт дома' : 'Подобрать мебель для всего дома'}</button>
    <div class="whole-home-results" aria-live="polite">${resultHtml(record)}</div>
  </div>`;
}

function update(panel) {
  const button = panel.querySelector('#arrangeWholeHomeBtn');
  if (button) button.textContent = activeTask ? 'Отменить расчёт дома' : 'Подобрать мебель для всего дома';
  const results = panel.querySelector('.whole-home-results');
  if (results) results.innerHTML = resultHtml(cache());
}

function progressLabel(progress) {
  const detail = progress?.detail || progress || {};
  if (detail.phase === 'rooms') return `Комнаты: ${detail.completed || 0} из ${detail.total || '…'}`;
  if (detail.phase === 'compose') return `Собираем варианты: ${detail.completed || 0} из ${detail.total || '…'}`;
  if (progress?.phase === 'restore') return 'Подготавливаем проект…';
  if (progress?.phase === 'solve') return 'Расставляем мебель по комнатам…';
  if (progress?.phase === 'validate') return 'Проверяем результат…';
  return 'Считаем варианты дома…';
}

async function start(panel) {
  state.wholeHomeLayoutVariants = null;
  progressText = 'Подготавливаем проект…';
  const task = client.startSolve({
    project: state.project,
    scope: SCOPE,
    options: OPTIONS,
    getCurrentProject: () => state.project,
    onProgress: (progress) => {
      progressText = progressLabel(progress);
      update(panel);
    },
  });
  activeTask = task;
  update(panel);
  try {
    const result = await task.promise;
    state.wholeHomeLayoutVariants = { inputSignature: task.inputSignature, result };
  } catch (error) {
    if (!(error instanceof LayoutSolveCancelledError) && !(error instanceof StaleLayoutResultError)) {
      console.error('Авторасстановка всего дома не посчиталась:', error);
      state.wholeHomeLayoutVariants = {
        inputSignature: currentSignature(),
        result: { status: 'search_budget_exhausted', variants: [], diagnostics: [error.message] },
      };
    } else if (error instanceof StaleLayoutResultError) {
      toast('Проект изменился — запустите расчёт дома заново', true);
    }
  } finally {
    if (activeTask === task) activeTask = null;
    progressText = '';
    update(panel);
  }
}

function applyVariant(panel, variantId, onApplied) {
  const record = cache();
  const variant = record?.result?.variants?.find((entry) => entry.id === variantId);
  if (!record || !variant) {
    toast('Вариант дома устарел — подберите заново', true);
    update(panel);
    return;
  }
  import('./store.js').then(({ mutate }) => {
    if (record.inputSignature !== currentSignature()) throw new StaleLayoutResultError();
    let report;
    mutate(() => { report = applyWholeHomeLayout(state.project, variant); });
    state.wholeHomeLayoutVariants = null;
    onApplied?.();
    toast(`Применено: ${report.moved.length} предметов, добавлено ${report.added.length} · Ctrl+Z — отменить`);
  }).catch((error) => {
    console.error('Вариант всего дома не применился:', error);
    toast(error?.code === 'STALE_LAYOUT_LOCK'
      ? 'Закреплённая мебель изменилась — подберите варианты заново'
      : 'Вариант дома устарел — подберите заново', true);
  });
}

export function bindWholeHomeLayout(panel, { onApplied = null } = {}) {
  if (!panel) return;
  panel.querySelector('#arrangeWholeHomeBtn')?.addEventListener('click', () => {
    if (activeTask) {
      activeTask.cancel();
      return;
    }
    start(panel);
  });
  panel.querySelector('.whole-home-results')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-whole-home-apply]');
    if (button) applyVariant(panel, button.dataset.wholeHomeApply, onApplied);
  });
}

export function invalidateWholeHomeVariants() {
  state.wholeHomeLayoutVariants = null;
  activeTask?.cancel();
}

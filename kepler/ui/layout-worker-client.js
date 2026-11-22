// Клиент Worker авторасстановки. Каждый solve получает собственный Worker:
// terminate() немедленно останавливает синхронный поиск и не задевает другие
// запросы. Ответ принимается только при совпадении requestId и сигнатуры.

import { solveLayoutRequest } from '../core/layout-worker-handler.js';
import {
  createLayoutSolveRequest, isLayoutProtocolMessage, LAYOUT_MESSAGE,
  normalizeLayoutScope, normalizeSearchBudget,
} from '../core/layout-protocol.js';
import { createSolverSnapshot, solverInputSignature } from '../core/solver-snapshot.js';

export const DEFAULT_LAYOUT_WORKER_URL = new URL('../workers/layout-worker.js', import.meta.url);

export class LayoutWorkerUnavailableError extends Error {
  constructor(message = 'Web Worker авторасстановки недоступен') {
    super(message);
    this.name = 'LayoutWorkerUnavailableError';
    this.code = 'LAYOUT_WORKER_UNAVAILABLE';
  }
}

export class LayoutSolveCancelledError extends Error {
  constructor(message = 'Расчёт расстановки отменён') {
    super(message);
    this.name = 'LayoutSolveCancelledError';
    this.code = 'LAYOUT_CANCELLED';
  }
}

export class StaleLayoutResultError extends Error {
  constructor(message = 'Проект изменился во время расчёта') {
    super(message);
    this.name = 'StaleLayoutResultError';
    this.code = 'LAYOUT_RESULT_STALE';
  }
}

function errorFromResponse(response) {
  const error = new Error(response.error?.message || 'Ошибка Worker авторасстановки');
  error.name = response.error?.name || 'LayoutWorkerError';
  error.code = response.error?.code || 'LAYOUT_SOLVE_FAILED';
  return error;
}

function defaultWorkerFactory(url) {
  if (typeof Worker !== 'function') throw new LayoutWorkerUnavailableError();
  return new Worker(url, { type: 'module', name: 'kepler-layout-solver' });
}

export async function solveLayoutOnMainThread(request, { onProgress = null } = {}) {
  if (request.scope.kind !== 'room') {
    throw new LayoutWorkerUnavailableError('Расчёт всего дома требует Web Worker');
  }
  return solveLayoutRequest(request, { onProgress });
}

function currentSignatureOf(config, snapshot, scope, options) {
  if (typeof config.getCurrentInputSignature === 'function') return config.getCurrentInputSignature();
  if (typeof config.getCurrentProject === 'function') {
    return solverInputSignature(createSolverSnapshot(config.getCurrentProject()), scope, options);
  }
  if (typeof config.inputSignature === 'string' && config.inputSignature) return config.inputSignature;
  return solverInputSignature(snapshot, scope, options);
}

export class LayoutWorkerClient {
  constructor({ workerFactory = defaultWorkerFactory, workerUrl = DEFAULT_LAYOUT_WORKER_URL } = {}) {
    this.workerFactory = workerFactory;
    this.workerUrl = workerUrl;
    this.tasks = new Map();
  }

  startSolve(config = {}) {
    const snapshot = config.snapshot || createSolverSnapshot(config.project);
    const scope = normalizeLayoutScope(config.scope);
    const options = normalizeSearchBudget(config.options);
    const inputSignature = config.inputSignature || solverInputSignature(snapshot, scope, options);
    const request = createLayoutSolveRequest({
      requestId: config.requestId,
      inputSignature,
      scope,
      snapshot,
      options,
    });

    let settled = false;
    let worker = null;
    let rejectPromise;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      this.tasks.delete(request.requestId);
      worker?.terminate?.();
      callback(value);
    };
    const promise = new Promise((resolve, reject) => {
      rejectPromise = reject;
      const acceptResult = (result) => {
        let current;
        try { current = currentSignatureOf(config, snapshot, scope, options); } catch (error) {
          finish(reject, error); return;
        }
        if (current !== request.inputSignature) {
          finish(reject, new StaleLayoutResultError());
          return;
        }
        finish(resolve, result);
      };

      try {
        worker = this.workerFactory(this.workerUrl, request);
      } catch (error) {
        if (scope.kind !== 'room' || config.fallback === false) {
          finish(reject, error?.code ? error : new LayoutWorkerUnavailableError(error?.message));
          return;
        }
        queueMicrotask(async () => {
          try {
            const result = await solveLayoutOnMainThread(request, { onProgress: config.onProgress });
            acceptResult(result);
          } catch (fallbackError) {
            finish(reject, fallbackError);
          }
        });
        return;
      }

      worker.addEventListener('message', (event) => {
        const response = event.data;
        if (!isLayoutProtocolMessage(response)
          || response.requestId !== request.requestId
          || response.inputSignature !== request.inputSignature) return;
        if (response.type === LAYOUT_MESSAGE.PROGRESS) {
          config.onProgress?.(response.progress);
        } else if (response.type === LAYOUT_MESSAGE.RESULT) {
          acceptResult(response.result);
        } else if (response.type === LAYOUT_MESSAGE.CANCELLED) {
          finish(reject, new LayoutSolveCancelledError());
        } else if (response.type === LAYOUT_MESSAGE.ERROR) {
          finish(reject, errorFromResponse(response));
        }
      });
      worker.addEventListener('error', (event) => {
        finish(reject, new Error(event.message || 'Worker авторасстановки завершился с ошибкой'));
      });
      queueMicrotask(() => {
        if (settled) return;
        try {
          worker.postMessage(request);
        } catch (error) {
          finish(reject, error);
        }
      });
    });

    const cancel = () => {
      if (settled) return false;
      // terminate() — единственный немедленный способ прервать синхронный
      // beam search; следующий запрос создаст чистый Worker.
      worker?.terminate?.();
      finish(rejectPromise, new LayoutSolveCancelledError());
      return true;
    };
    const task = { requestId: request.requestId, inputSignature, promise, cancel };
    this.tasks.set(request.requestId, task);
    return task;
  }

  solve(config = {}) {
    return this.startSolve(config).promise;
  }

  cancel(requestId) {
    return this.tasks.get(requestId)?.cancel() || false;
  }

  cancelAll() {
    for (const task of [...this.tasks.values()]) task.cancel();
  }
}

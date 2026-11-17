// Чистый обработчик Worker: его можно тестировать без настоящего потока.

import { generateFurnitureLayouts } from './autolayout.js';
import { planWholeHomeLayout } from './whole-home-layout.js';
import {
  isLayoutProtocolMessage, layoutResponse, LAYOUT_MESSAGE, serializableLayoutError,
} from './layout-protocol.js';
import { levelProject, roomById } from './model.js';
import { restoreSolverSnapshot } from './solver-snapshot.js';
import { deriveWalls } from './walls.js';

export class LayoutCancelledError extends Error {
  constructor(message = 'Расчёт отменён') {
    super(message);
    this.name = 'LayoutCancelledError';
    this.code = 'LAYOUT_CANCELLED';
  }
}

function assertNotCancelled(isCancelled) {
  if (isCancelled?.()) throw new LayoutCancelledError();
}

function roomOptions(options) {
  return {
    count: options.count,
    beamWidth: options.beamWidth,
    candidatesPerItem: options.candidatesPerItem,
    maxBasePoses: options.maxBasePoses,
    lockedIds: options.lockedIds || [],
    itemIds: options.itemIds || null,
  };
}

export function solveRoomLayoutRequest(project, scope, options, solve = generateFurnitureLayouts) {
  if (scope.levelId && !project.levels.some((level) => level.id === scope.levelId)) {
    const error = new Error(`Этаж ${scope.levelId} не найден`);
    error.code = 'LEVEL_NOT_FOUND';
    throw error;
  }
  const target = scope.levelId ? levelProject(project, scope.levelId) : project;
  const room = roomById(target, scope.roomId);
  if (!room) {
    const error = new Error(`Комната ${scope.roomId} не найдена`);
    error.code = 'ROOM_NOT_FOUND';
    throw error;
  }
  return solve(target, room, deriveWalls(target), roomOptions(options));
}

export function solveProjectLayoutRequest(project, options, solve = planWholeHomeLayout, onProgress = null, isCancelled = null) {
  return solve(project, {
    ...options,
    shouldCancel: () => Boolean(isCancelled?.()),
    onProgress,
  });
}

export async function solveLayoutRequest(request, {
  roomSolver = generateFurnitureLayouts,
  projectSolver = planWholeHomeLayout,
  onProgress = null,
  isCancelled = null,
} = {}) {
  if (!isLayoutProtocolMessage(request) || request.type !== LAYOUT_MESSAGE.SOLVE) {
    const error = new Error('Некорректный запрос авторасстановки');
    error.code = 'INVALID_LAYOUT_REQUEST';
    throw error;
  }
  assertNotCancelled(isCancelled);
  onProgress?.({ phase: 'restore', completed: 0, total: 3 });
  const project = restoreSolverSnapshot(request.snapshot);
  assertNotCancelled(isCancelled);
  onProgress?.({ phase: 'solve', completed: 1, total: 3 });
  const pending = request.scope.kind === 'project'
    ? solveProjectLayoutRequest(project, request.options, projectSolver, (progress) => {
      onProgress?.({ phase: 'rooms', completed: 1, total: 3, detail: progress });
    }, isCancelled)
    : solveRoomLayoutRequest(project, request.scope, request.options, roomSolver);
  const result = await Promise.resolve(pending);
  assertNotCancelled(isCancelled);
  onProgress?.({ phase: 'validate', completed: 2, total: 3 });
  assertNotCancelled(isCancelled);
  onProgress?.({ phase: 'done', completed: 3, total: 3 });
  return result;
}

export function createLayoutWorkerHandler({
  postMessage: send,
  roomSolver = generateFurnitureLayouts,
  projectSolver = planWholeHomeLayout,
} = {}) {
  if (typeof send !== 'function') throw new Error('Worker handler: нужна функция postMessage');
  const cancelled = new Set();

  return async function handleLayoutWorkerMessage(eventOrMessage) {
    const request = eventOrMessage?.data || eventOrMessage;
    if (!isLayoutProtocolMessage(request)) return false;
    if (request.type === LAYOUT_MESSAGE.CANCEL) {
      cancelled.add(request.requestId);
      send(layoutResponse(LAYOUT_MESSAGE.CANCELLED, request));
      return true;
    }
    if (request.type !== LAYOUT_MESSAGE.SOLVE) return false;
    const isCancelled = () => cancelled.has(request.requestId);
    try {
      const result = await solveLayoutRequest(request, {
        roomSolver,
        projectSolver,
        isCancelled,
        onProgress: (progress) => send(layoutResponse(LAYOUT_MESSAGE.PROGRESS, request, { progress })),
      });
      send(layoutResponse(LAYOUT_MESSAGE.RESULT, request, { result }));
    } catch (error) {
      const type = error?.code === 'LAYOUT_CANCELLED' ? LAYOUT_MESSAGE.CANCELLED : LAYOUT_MESSAGE.ERROR;
      send(layoutResponse(type, request, { error: serializableLayoutError(error) }));
    } finally {
      cancelled.delete(request.requestId);
    }
    return true;
  };
}

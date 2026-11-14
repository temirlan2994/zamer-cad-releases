// Версионированный протокол между UI и Worker авторасстановки.
// Сообщения остаются обычными structured-clone объектами: без функций,
// экземпляров классов и неявных ссылок на состояние вкладки.

export const LAYOUT_PROTOCOL_VERSION = 1;

export const LAYOUT_MESSAGE = Object.freeze({
  SOLVE: 'solve',
  CANCEL: 'cancel',
  PROGRESS: 'progress',
  RESULT: 'result',
  ERROR: 'error',
  CANCELLED: 'cancelled',
});

let requestCounter = 0;

export function nextLayoutRequestId() {
  requestCounter += 1;
  return `layout-${Date.now().toString(36)}-${requestCounter.toString(36)}`;
}

export function normalizeLayoutScope(scope = {}) {
  const kind = scope.kind === 'project' ? 'project' : 'room';
  return Object.freeze({
    kind,
    levelId: typeof scope.levelId === 'string' && scope.levelId ? scope.levelId : null,
    roomId: kind === 'room' && typeof scope.roomId === 'string' && scope.roomId ? scope.roomId : null,
  });
}

export function normalizeSearchBudget(options = {}) {
  const clean = {};
  for (const [key, value] of Object.entries(options)) {
    if (['signal', 'shouldCancel', 'onProgress'].includes(key) || typeof value === 'function' || value === undefined) continue;
    // Опции протокола обязаны переживать structured clone. JSON-копия заодно
    // исключает DOM-объекты и случайные прототипы из состояния UI.
    try { clean[key] = JSON.parse(JSON.stringify(value)); } catch { /* неподдерживаемый ввод не передаём */ }
  }
  const requested = Number(options.searchBudget);
  const searchBudget = Number.isFinite(requested) ? Math.max(1, Math.min(100, Math.round(requested))) : 40;
  const count = Math.max(1, Math.min(6, Math.round(Number(options.count) || 3)));
  // Бюджет задаёт количество состояний, а не миллисекунды. Одинаковый вход
  // поэтому даёт одинаковый результат даже на разных устройствах.
  return Object.freeze({
    ...clean,
    count,
    searchBudget,
    beamWidth: Math.max(8, Math.min(240, Math.round(options.beamWidth || searchBudget * 2))),
    candidatesPerItem: Math.max(8, Math.min(80, Math.round(options.candidatesPerItem || searchBudget))),
    maxBasePoses: Math.max(32, Math.min(320, Math.round(options.maxBasePoses || searchBudget * 2.4))),
  });
}

export function createLayoutSolveRequest({
  requestId = nextLayoutRequestId(), inputSignature, scope, snapshot, options = {},
} = {}) {
  if (typeof inputSignature !== 'string' || !inputSignature) throw new Error('Нужна сигнатура входа авторасстановки');
  if (!snapshot || typeof snapshot !== 'object') throw new Error('Нужен снимок проекта авторасстановки');
  const normalizedScope = normalizeLayoutScope(scope);
  if (normalizedScope.kind === 'room' && !normalizedScope.roomId) throw new Error('Для room solve нужен roomId');
  return {
    protocol: LAYOUT_PROTOCOL_VERSION,
    type: LAYOUT_MESSAGE.SOLVE,
    requestId,
    inputSignature,
    scope: normalizedScope,
    snapshot,
    options: normalizeSearchBudget(options),
  };
}

export function createLayoutCancelRequest(requestId, inputSignature = null) {
  return {
    protocol: LAYOUT_PROTOCOL_VERSION,
    type: LAYOUT_MESSAGE.CANCEL,
    requestId,
    inputSignature,
  };
}

export function isLayoutProtocolMessage(value) {
  return Boolean(value && typeof value === 'object'
    && value.protocol === LAYOUT_PROTOCOL_VERSION
    && typeof value.type === 'string'
    && typeof value.requestId === 'string');
}

export function layoutResponse(type, request, payload = {}) {
  return {
    protocol: LAYOUT_PROTOCOL_VERSION,
    type,
    requestId: request.requestId,
    inputSignature: request.inputSignature,
    ...payload,
  };
}

export function serializableLayoutError(error) {
  return {
    name: typeof error?.name === 'string' ? error.name : 'Error',
    message: typeof error?.message === 'string' ? error.message : 'Неизвестная ошибка авторасстановки',
    code: typeof error?.code === 'string' ? error.code : 'LAYOUT_SOLVE_FAILED',
  };
}

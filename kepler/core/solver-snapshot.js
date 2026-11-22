// Переносимый снимок проекта для решателя. Корневые room/items/openings в
// Kepler — non-enumerable accessors активного этажа, поэтому источником
// всегда служит levels[], а после передачи проект восстанавливает model.js.

import { projectFromData } from './model.js';

export const SOLVER_SNAPSHOT_VERSION = 1;

function jsonClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const key of Object.keys(value).sort()) {
    const nested = value[key];
    if (nested !== undefined && typeof nested !== 'function') result[key] = stableValue(nested);
  }
  return result;
}

export function stableLayoutStringify(value) {
  return JSON.stringify(stableValue(value));
}

// FNV-1a/64: это guard от устаревшего ответа, не криптографическая подпись.
export function layoutStringSignature(text) {
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= BigInt(text.charCodeAt(i));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}

export function createSolverSnapshot(project) {
  if (!project || !Array.isArray(project.levels)) throw new Error('Проект не содержит levels[]');
  const data = jsonClone(project);
  if (!Array.isArray(data.levels)) throw new Error('Снимок потерял levels[]');
  return {
    version: SOLVER_SNAPSHOT_VERSION,
    schema: data.schema || null,
    project: data,
  };
}

export function restoreSolverSnapshot(snapshot) {
  if (!snapshot || snapshot.version !== SOLVER_SNAPSHOT_VERSION || !snapshot.project) {
    throw new Error('Неподдерживаемый снимок проекта авторасстановки');
  }
  // projectFromData нормализует объект на месте, поэтому Worker получает копию
  // и не меняет request/snapshot, который может использоваться для повтора.
  return projectFromData(jsonClone(snapshot.project));
}

export function solverInputSignature(snapshot, scope = null, options = null) {
  return `v${SOLVER_SNAPSHOT_VERSION}-${layoutStringSignature(stableLayoutStringify({ snapshot, scope, options }))}`;
}

// Жесты блоков на номинальной модели (docs/v7-stage2-plan.md, срез 3).
//
// • Перенос/растяжение съеденной комнаты идёт по её НОМИНАЛЬНОЙ форме:
//   в начале жеста liftRoom возвращает номинал, на каждом кадре
//   reconcileEats заново считает видимые формы — нижняя комната меняется
//   во время жеста, а не в конце.
// • Магнит блоков (core/v7/magnet.js): 300 мм, тумблер «Примагничивание
//   блоков» в «Привязках»; Shift или Alt — временно без магнита.

import { activeLevel } from '../core/model.js';
import { eatState, liftRoom, reconcileEats } from '../core/v7/eat-bridge.js';
import { magnetEdges, magnetSnap } from '../core/v7/magnet.js';
import { migrateLevel } from '../core/v7/migrate.js';
import { state } from './state.js';

export const MAGNET_MM = 300;
const FRAME_BUDGET_MS = 12; // дольше — пересчёт съедания реже (не каждый кадр)
const SLOW_STEP_MS = 60;

// Включён ли магнит для этого события мыши/клавиатуры.
export function magnetOn(event) {
  if (state.snapSettings?.magnet === false) return false; // ui/draw-snap-ui.js (localStorage)
  return !(event?.shiftKey || event?.altKey);
}

// Снимок этажа в форме v7 для магнита (по номиналам) — один раз за жест.
export function magnetProject(project = state.project) {
  const lvl = activeLevel(project) || project;
  const level = migrateLevel({ ...lvl, rooms: project.rooms, walls: lvl.walls || [], openings: [], items: [] }, project.settings || {});
  level.id = level.id || 'level';
  return { levels: [level], activeLevel: level.id, settings: project.settings || {} };
}

function setParent(p7, id, parentId) {
  const b = p7.levels[0].blocks.find((x) => x.id === id);
  if (b) b.parentId = parentId || null;
}

// Перенос: прижать габарит { x, y, w, h } к соседям. → { x, y, snappedX, snappedY, guides }.
export function magnetMove(drag, id, rect, parentId, event) {
  const none = { x: rect.x, y: rect.y, snappedX: false, snappedY: false, guides: [] };
  if (!magnetOn(event)) return none;
  if (!drag.magnet) drag.magnet = magnetProject();
  setParent(drag.magnet, id, parentId);
  const m = magnetSnap(drag.magnet, id, rect, { distance: MAGNET_MM });
  return { x: m.x, y: m.y, snappedX: m.dx !== 0 || m.guides.some((g) => g.axis === 'x'), snappedY: m.dy !== 0 || m.guides.some((g) => g.axis === 'y'), guides: m.guides.map(planGuide) };
}

// Растяжение: прижать подвижные грани. edges — буквы ручки ('ne' → n, e).
export function magnetResize(drag, id, rect, handle, event) {
  if (!magnetOn(event)) return { rect, guides: [], edges: [] };
  if (!drag.magnet) drag.magnet = magnetProject();
  const edges = ['w', 'e', 'n', 's'].filter((e) => handle.includes(e));
  const m = magnetEdges(drag.magnet, id, rect, edges, { distance: MAGNET_MM });
  return { rect: m.rect, guides: m.guides.map(planGuide), edges: m.guides.map((g) => g.edge) };
}

// Направляющая магнита → формат state.guides (render.js).
const planGuide = (g) => ({ type: 'magnet', axis: g.axis === 'x' ? 'v' : 'h', at: g.at, from: g.from, to: g.to, kind: g.kind });

// Начало жеста: съеденным комнатам — номинал (один раз за жест).
export function liftForGesture(drag, ids) {
  if (drag.lifted) return false;
  drag.lifted = true;
  drag.eatPrev = eatState(state.project);
  let changed = false;
  for (const id of ids) changed = liftRoom(state.project, id) || changed;
  return changed;
}

// Съедание на кадре жеста. opts — как у reconcileEats (touched, under).
// Если пересчёт дорог (большой проект) — не чаще раза в SLOW_STEP_MS;
// в конце жеста всё равно считается окончательно (eatOverlapsAfter).
export function liveEat(drag, opts) {
  const now = performance.now();
  if (drag.eatSlow && now - (drag.eatAt || 0) < SLOW_STEP_MS) return null;
  const res = reconcileEats(state.project, opts);
  const spent = performance.now() - now;
  drag.eatAt = performance.now();
  drag.eatSlow = spent > FRAME_BUDGET_MS;
  return res;
}

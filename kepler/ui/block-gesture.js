// Жесты блоков на номинальной модели (docs/v7-stage2-plan.md, срез 3).
//
// • Перенос/растяжение съеденной комнаты идёт по её НОМИНАЛЬНОЙ форме:
//   в начале жеста liftRoom возвращает номинал, на каждом кадре
//   reconcileEats заново считает видимые формы — нижняя комната меняется
//   во время жеста, а не в конце.
// • Магнит блоков (core/v7/magnet.js): 300 мм, тумблер «Примагничивание
//   блоков» в «Привязках»; Shift или Alt — временно без магнита.
// • Ручка грани на общей стене двигает и встречные грани соседей
//   (core/wall-follow.js) — стена остаётся одной; Alt — оторвать.

import { activeLevel } from '../core/model.js';
import { eatState, liftRoom, nominalShape, reconcileEats } from '../core/v7/eat-bridge.js';
import { applyFollow, findFollowers, startFollow } from '../core/wall-follow.js';
import { magnetEdges, magnetSnap } from '../core/v7/magnet.js';
import { migrateLevel } from '../core/v7/migrate.js';
import { snapRectToSketch } from '../core/masses.js';
import { DEFAULT_EXTERIOR } from '../core/catalog.js';
import { massSnapLines } from './plan-masses.js';
import { snapRectToGrids } from '../core/grid-axes.js';
import { activeGrids, gridExtentOf, gridSnapOffsets, planGridPref } from './plan-grids.js';
import { wallBody, wallMagnet, wallPins } from '../core/grid-pins.js';
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
  const out = { x: m.x, y: m.y, snappedX: m.dx !== 0 || m.guides.some((g) => g.axis === 'x'), snappedY: m.dy !== 0 || m.guides.some((g) => g.axis === 'y'), guides: m.guides.map(planGuide) };
  return sketchMagnet(out, rect);
}

// Эскиз масс (ui/plan-masses.js): свободные от магнита блоков оси липнут к
// рёбрам контура — грань помещения на ребре или внутри на толщину наружной стены.
const sketchInset = () => Number(state.project?.settings?.exterior) || DEFAULT_EXTERIOR;

export function sketchMagnet(out, rect) {
  gridMagnet(out, rect);
  const lines = massSnapLines();
  if (!lines || (out.snappedX && out.snappedY)) return out;
  const s = snapRectToSketch({ ...rect }, lines, { distance: MAGNET_MM, inset: sketchInset(), skipX: out.snappedX, skipY: out.snappedY });
  if (s.snappedX) { out.x = s.x; out.snappedX = true; }
  if (s.snappedY) { out.y = s.y; out.snappedY = true; }
  out.guides = [...out.guides, ...s.guides];
  return out;
}

// Координационные оси (ui/plan-grids.js): грань помещения (или наружная
// грань / ось его стены — по настройке) липнет к оси в радиусе 300 мм. Ось
// берёт верх над магнитом соседей, если она ближе. Тумблер — тот же, что у
// магнита блоков; Shift/Alt — без привязки (проверяют вызывающие).
export function gridMagnet(out, rect) {
  if (state.snapSettings?.magnet === false) return out;
  const grids = activeGrids();
  if (!grids.length) return out;
  const g = snapRectToGrids({ ...rect }, grids, { distance: MAGNET_MM, offsets: gridSnapOffsets(), extent: (x) => gridExtentOf(x) });
  for (const [axis, p, flag, dir] of [['x', 'x', 'snappedX', 'v'], ['y', 'y', 'snappedY', 'h']]) {
    if (!g[flag]) continue;
    const mine = Math.abs(g[p] - rect[p]);
    const theirs = Math.abs(out[p] - rect[p]);
    if (out[flag] && theirs < mine) continue;
    out[p] = g[p];
    out[flag] = true;
    out.guides = [...out.guides.filter((x) => x.axis !== dir), ...g.guides.filter((x) => x.axis === dir)];
    if (axis === 'x') out.gridX = g.guides.find((x) => x.axis === 'v')?.gridId; else out.gridY = g.guides.find((x) => x.axis === 'h')?.gridId;
  }
  return out;
}

// Перетаскивание стены (жест 'wall', ui/input.js): опорная линия тела —
// наружная грань или ось стены (настройка «Привязка к оси») — к ближайшей
// оси своего направления в радиусе 300 мм. Прикреплённая стена липнет к
// своей оси той же линией. raw — сдвиг мыши поперёк стены (мм).
// → { delta, grid, guide } | null (нет оси рядом, магнит выключен, Shift/Alt).
export function wallGridMagnet(drag, raw, event) {
  if (!magnetOn(event)) return null;
  const grids = activeGrids();
  if (!grids.length) return null;
  const body = wallBody(drag.wall);
  if (!body) return null;
  if (drag.pinRef === undefined) {
    // Прикреплённая стена: опорная линия — та, что стоит на её оси.
    const pin = wallPins(state.project, drag.wall).find((p) => p.part === 'line');
    const g = pin && grids.find((x) => x.id === pin.gridId);
    const ref = g && [body.lo, body.mid, body.hi].find((r) => Math.abs(r - g.at) <= 1);
    drag.pinRef = ref !== undefined && g ? { gridId: g.id, ref } : null;
  }
  const m = wallMagnet(body, raw, grids, { mode: planGridPref().snap, radius: MAGNET_MM, extent: (g) => gridExtentOf(g), pinned: drag.pinRef });
  if (!m) return null;
  const ext = gridExtentOf(m.grid);
  const guide = {
    type: 'magnet', kind: 'align', axis: body.orient === 'h' ? 'h' : 'v', at: m.grid.at, gridId: m.grid.id,
    from: Math.min(body.from, ext.from), to: Math.max(body.to, ext.to),
  };
  return { delta: m.delta, grid: m.grid, guide };
}

// Растяжение: прижать подвижные грани. edges — буквы ручки ('ne' → n, e).
export function magnetResize(drag, id, rect, handle, event) {
  if (!magnetOn(event)) return { rect, guides: [], edges: [] };
  if (!drag.magnet) drag.magnet = magnetProject();
  const edges = ['w', 'e', 'n', 's'].filter((e) => handle.includes(e));
  const skip = (drag.follow || []).map((f) => f.id); // попутчики общей стены едут с гранью
  const m = magnetEdges(drag.magnet, id, rect, edges, { distance: MAGNET_MM, skip });
  const out = { rect: m.rect, guides: m.guides.map(planGuide), edges: m.guides.map((g) => g.edge) };
  // Координационные оси (ui/plan-grids.js): подвижные грани без магнита соседей.
  const gridFree = edges.filter((e) => !out.edges.includes(e));
  const grids = state.snapSettings?.magnet === false ? [] : activeGrids();
  if (grids.length && gridFree.length) {
    const g = snapRectToGrids(out.rect, grids, { distance: MAGNET_MM, offsets: gridSnapOffsets(), edges: gridFree, extent: (x) => gridExtentOf(x) });
    if (g.snappedX || g.snappedY) {
      out.rect = { x: g.x, y: g.y, w: g.w, h: g.h };
      out.guides = [...out.guides, ...g.guides];
      out.edges = [...out.edges, ...gridFree.filter((e) => ((e === 'w' || e === 'e') ? g.snappedX : g.snappedY))];
    }
  }
  const lines = massSnapLines();
  const free = edges.filter((e) => !out.edges.includes(e));
  if (lines && free.length) {
    const s = snapRectToSketch(out.rect, lines, { distance: MAGNET_MM, inset: sketchInset(), edges: free });
    if (s.snappedX || s.snappedY) {
      out.rect = { x: s.x, y: s.y, w: s.w, h: s.h };
      out.guides = [...out.guides, ...s.guides];
      out.edges = [...out.edges, ...free.filter((e) => ((e === 'w' || e === 'e') ? s.snappedX : s.snappedY))];
    }
  }
  return out;
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

// Общая стена при растяжении ручкой (core/wall-follow.js): попутчики —
// встречные грани соседей — ищутся один раз за жест по номиналам, съеденным
// из них возвращается номинал. movingEdges — подвижные грани (номинал).
export function captureFollow(drag, roomId, movingEdges) {
  if (drag.follow) return drag.follow;
  const found = findFollowers(state.project.rooms, roomId, movingEdges, { shapeOf: nominalShape });
  for (const f of found) liftRoom(state.project, f.id);
  drag.follow = startFollow(state.project, found);
  return drag.follow;
}

// Кадр: попутчики сдвигаются на delta { x, y } от снимка начала; null —
// «оторвать» (Alt): соседи стоят на месте. → отчёт applyFollow.
export function followFrame(drag, delta) {
  // Съели на прошлом кадре — снова номинал и проёмы-сироты (как у растягиваемой).
  for (const f of drag.follow || []) liftRoom(state.project, f.id);
  return applyFollow(state.project, drag.follow || [], delta);
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

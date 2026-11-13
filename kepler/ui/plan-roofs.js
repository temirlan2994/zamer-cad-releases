// Крыши-плиты на плане (core/roofs.js) — общее для рисования (ui/render-roofs.js)
// и правки (ui/roofs.js, ui/roof-plan.js) без DOM: список и выбор, вид «План
// крыши» (state.roofPlan — режим «План», где видны и правятся только крыши),
// контур плиты, ручки выбранной крыши на экране, настройка вида
// (localStorage): бледный контур кровли на плане этажа (выкл), на
// листах/печати (выкл).

import {
  roofFromRooms, roofHandles, roofOutlineHandles, roofOverRoom, roofSlabEdges,
} from '../core/roofs.js';
import { state } from './state.js';

export const roofs = () => (Array.isArray(state.project?.roofs) ? state.project.roofs : []);
export const roofById = (id) => roofs().find((r) => r.id === id) || null;
export const selectedRoof = () => (state.selection?.type === 'roof' ? roofById(state.selection.id) : null);

// Открыт «План крыши»: режим «План» с флагом state.roofPlan.
export const isRoofPlan = () => Boolean(state.roofPlan) && state.modeName === 'plan';

// Открыть «План крыши» из дерева видов (ui/props-views.js регистрирует openView).
let roofPlanOpener = null;
export const setRoofPlanOpener = (fn) => { roofPlanOpener = fn; };
export function openRoofPlanView() {
  if (roofPlanOpener) roofPlanOpener();
  else state.roofPlan = true;
}

const KEY = 'kepler-plan-roofs';
export const PLAN_ROOF_DEFAULT = Object.freeze({ on: false, print: false });

export function normalizePlanRoof(v) {
  return {
    on: typeof v?.on === 'boolean' ? v.on : PLAN_ROOF_DEFAULT.on,
    print: typeof v?.print === 'boolean' ? v.print : PLAN_ROOF_DEFAULT.print,
  };
}

export function planRoofPref() {
  if (!state.planRoof) {
    let raw;
    try { raw = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { raw = null; }
    state.planRoof = normalizePlanRoof(raw);
  }
  return state.planRoof;
}

export function setPlanRoofPref(patch) {
  state.planRoof = normalizePlanRoof({ ...planRoofPref(), ...patch });
  try { localStorage.setItem(KEY, JSON.stringify(state.planRoof)); } catch { /* только на сессию */ }
  return state.planRoof;
}

// Контур плиты (рёбра) для рисования.
export function roofOutlineEdges(roof) {
  return roofSlabEdges(state.project, roof);
}

// Призрак будущей крыши по форме помещения (инструмент «Крыша» в 3D и на
// «Плане крыши»): помещение уже под крышей — она сама.
export function ghostRoofFor(levelId, roomId) {
  const room = (state.project.levels || []).find((l) => l.id === levelId)?.rooms?.find((r) => r.id === roomId);
  if (!room) return null;
  return roofOverRoom(state.project, levelId, room) || roofFromRooms(state.project, levelId, [roomId], {}, roofs());
}

// Ручки выбранной крыши на «Плане крыши» (экран): вершины и середины рёбер
// контура, точки выноса по сторонам.
export function planRoofHandles(p2s) {
  const roof = selectedRoof();
  if (!roof || !isRoofPlan()) return [];
  const outline = roofOutlineHandles(roof).map((h) => ({ ...h, group: 'outline', s: p2s(h.x, h.y) }));
  const over = roofHandles(state.project, roof).filter((h) => h.id.length === 1)
    .map((h) => ({ ...h, kind: 'overhang', group: 'overhang', s: p2s(h.x, h.y) }));
  return [...outline, ...over];
}

let handleCache = []; // последние нарисованные ручки (экран)
export const rememberRoofHandles = (list) => { handleCache = list; };
export const drawnRoofHandles = () => handleCache;

// Крыши-плиты на плане (core/roofs.js) — общее для рисования (ui/render-roofs.js)
// и правки (ui/roofs.js) без DOM: список и выбор, контур плиты, призрак
// инструмента, ручки выбранной крыши на экране, настройка вида
// (localStorage): контур на плане (вкл), на листах/печати (выкл).

import {
  addRoomToRoof, createRoof, gridEdges, rectGrid, roofHandles, roofOfRoom, roofRects,
} from '../core/roofs.js';
import { state } from './state.js';

export const roofs = () => (Array.isArray(state.project?.roofs) ? state.project.roofs : []);
export const roofById = (id) => roofs().find((r) => r.id === id) || null;
export const selectedRoof = () => (state.selection?.type === 'roof' ? roofById(state.selection.id) : null);

const KEY = 'kepler-plan-roofs';
export const PLAN_ROOF_DEFAULT = Object.freeze({ on: true, print: false });

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
  const rects = roofRects(state.project, roof);
  return rects.length ? gridEdges(rectGrid([rects])) : [];
}

// Призрак будущей крыши над помещением (инструмент «Крыша»).
export function ghostRoofFor(levelId, roomId) {
  const own = roofOfRoom(state.project, levelId, roomId);
  if (own) return own;
  const target = roofById(state.tool?.addTo) || null;
  if (target && target.levelId === levelId) return addRoomToRoof(target, roomId);
  return createRoof({ levelId, roomIds: [roomId] }, roofs());
}

// Ручки выбранной крыши на плане (экран) — для попадания и рисования.
export function planRoofHandles(p2s) {
  const roof = selectedRoof();
  if (!roof || roof.levelId !== state.project.activeLevel || state.modeName !== 'plan') return [];
  return roofHandles(state.project, roof).map((h) => ({ ...h, s: p2s(h.x, h.y) }));
}

let handleCache = []; // последние нарисованные ручки (экран)
export const rememberRoofHandles = (list) => { handleCache = list; };
export const drawnRoofHandles = () => handleCache;

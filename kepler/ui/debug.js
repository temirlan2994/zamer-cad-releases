// Отладочный доступ для автотестов (window.__kepler).

import { openingRect } from '../core/walls.js';
import { loadSample } from './files.js';
import { setEditorMode } from './modes.js';
import { state } from './state.js';
import { selectObject } from './tools.js';
import { debug3d } from './view3d.js';
import {
  fitView, planToScreen, screenToPlan, screenToWorld, worldToScreen,
} from './view.js';

// Только с ?debug в адресе: обычным пользователям внутреннее состояние
// редактора в window не видно.
export function exposeDebugApi() {
  if (!new URLSearchParams(window.location.search).has('debug')) return;
  window.__kepler = {
    state,
    worldToScreen,
    screenToWorld,
    planToScreen, // оси дома ↔ экран
    debug3d,
    screenToPlan,
    fitView,
    loadSample,
    setEditorMode,
    selectRoom: (id) => selectObject({ type: 'room', id }),
    select: (sel) => selectObject(sel),
    openingCenter: (id) => {
      const o = state.project.openings.find((x) => x.id === id);
      if (!o) return null;
      const p = openingRect(state.project, o, state.walls);
      return p ? { x: p.rect.x + p.rect.w / 2, y: p.rect.y + p.rect.h / 2 } : null;
    },
    openingRectOf: (id) => {
      const o = state.project.openings.find((x) => x.id === id);
      if (!o) return null;
      const p = openingRect(state.project, o, state.walls);
      if (!p) return null;
      return { rect: p.rect, band: p.wall.band, thickness: p.wall.thickness, kind: p.wall.kind };
    },
  };
}

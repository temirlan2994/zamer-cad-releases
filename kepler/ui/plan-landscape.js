// Ландшафт на плане этажа: то, что начерчено в «Ландшафте», видно и в
// «Плане» — приглушённо, под комнатами и стенами, без ручек и выделения (ввод
// в плане его не ловит). Что показывать — настройка вида (вкладка «Виды»):
// главный переключатель и группы core/landscape.js LANDSCAPE_VIS. Только вид —
// в браузере (localStorage), не в проекте; на печать и экспорт не влияет.

import { LANDSCAPE_VIS, landscapeDef } from '../core/landscape.js';
import { state } from './state.js';

const KEY = 'kepler-plan-landscape';

// Группы, которые можно включать на плане (все из LANDSCAPE_VIS).
export const PLAN_LS_GROUPS = LANDSCAPE_VIS;

// По умолчанию: ландшафт виден, растения, покрытия и малые формы — да;
// тени, подписи и выноски — нет (план не загромождается).
export const PLAN_LS_DEFAULT = Object.freeze({
  on: true, shadows: false, plants: true, covers: true, objects: true, labels: false, notes: false,
});

// Приглушение слоя ландшафта на плане (0…1).
export const PLAN_LS_ALPHA = 0.55;

export function normalizePlanLs(v) {
  const out = { on: v?.on !== undefined ? v.on !== false : PLAN_LS_DEFAULT.on };
  for (const g of PLAN_LS_GROUPS) {
    out[g.id] = typeof v?.[g.id] === 'boolean' ? v[g.id] : PLAN_LS_DEFAULT[g.id];
  }
  return out;
}

function read() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
}
function write(v) {
  try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* нет доступа — только на сессию */ }
}

export function planLandscapePref() {
  if (!state.planLs) state.planLs = normalizePlanLs(read());
  return state.planLs;
}

export function setPlanLandscapePref(patch) {
  state.planLs = normalizePlanLs({ ...planLandscapePref(), ...patch });
  write(state.planLs);
  return state.planLs;
}

// «Только планировки»: ландшафт выключен целиком, все группы сняты.
export function planOnlyPref() {
  const patch = { on: false };
  for (const g of PLAN_LS_GROUPS) patch[g.id] = false;
  return setPlanLandscapePref(patch);
}

// Объекты для плана: пусто, если ландшафт выключен; иначе — по группам.
export function planLandscapeObjects(objects, pref = planLandscapePref()) {
  if (!pref?.on || !objects?.length) return [];
  return objects.filter((o) => {
    const vis = landscapeDef(o.kind)?.vis;
    return vis ? pref[vis] === true : pref.objects === true;
  });
}

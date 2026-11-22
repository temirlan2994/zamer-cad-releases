// Поворот ВИДА (камеры) по режимам «План», «Участок», «Ландшафт». Чистый
// модуль без DOM. Поворот вида не меняет данные: участок, дом и мебель стоят
// на месте, крутится только экран.
//
// Угол вида a — градусы по часовой (ось Y вниз): мировое направление a идёт
// на экране вправо; камера: view.rotation = −a·π/180.
// project.settings.viewAngles = { plan?, site?, landscape? } — углы,
// заданные пользователем (необязательное поле, схема не меняется). Нет
// угла — умолчание: «План» по осям дома (building.rotation), «Участок» и
// «Ландшафт» — север вверх (site.north).

import { normDeg, rotateBuildingAbout, rotationAlongLine } from './building.js';

export const VIEW_MODES = ['plan', 'site', 'landscape'];

// Угол в (−180; 180], с точностью 0,01°.
export function normViewAngle(deg) {
  const n = normDeg(deg);
  const s = n > 180 ? n - 360 : n;
  return Math.round(s * 100) / 100 || 0;
}

// Чистка поля settings.viewAngles: только известные режимы и конечные числа.
export function cleanViewAngles(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const out = {};
  for (const mode of VIEW_MODES) {
    const n = typeof v[mode] === 'string' && v[mode].trim() !== '' ? Number(v[mode]) : v[mode];
    if (typeof n === 'number' && Number.isFinite(n)) out[mode] = normViewAngle(n);
  }
  return Object.keys(out).length ? out : null;
}

const modeKey = (mode) => (VIEW_MODES.includes(mode) ? mode : 'plan');

export function defaultViewAngle(project, mode) {
  const deg = modeKey(mode) === 'plan' ? project?.building?.rotation : project?.site?.north;
  return normViewAngle(deg || 0);
}

// Угол, заданный пользователем, или null.
export function customViewAngle(project, mode) {
  const v = project?.settings?.viewAngles?.[modeKey(mode)];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function viewAngle(project, mode) {
  return customViewAngle(project, mode) ?? defaultViewAngle(project, mode);
}

// Поворот камеры (радианы) для режима.
export function viewRotation(project, mode) {
  const deg = viewAngle(project, mode);
  return deg ? -(deg * Math.PI) / 180 : 0; // без «-0»
}

// Угол вида, при котором линия a→b на экране горизонтальна. Из двух
// вариантов (θ и θ+180°) берётся ближайший к текущему — вид не
// переворачивается вверх ногами. null — точки совпадают.
export function lineViewAngle(a, b, currentDeg = 0) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.hypot(dx, dy) < 1e-6) return null;
  const theta = (Math.atan2(dy, dx) * 180) / Math.PI;
  const dist = (x) => { const d = Math.abs(normDeg(x) - normDeg(currentDeg)); return Math.min(d, 360 - d); };
  return normViewAngle(dist(theta) <= dist(theta + 180) ? theta : theta + 180);
}

// Новый план: на этажах нет ни комнат, ни стен.
export function isPlanEmpty(project) {
  const levels = Array.isArray(project?.levels) && project.levels.length ? project.levels : [project || {}];
  return levels.every((l) => !(l.rooms?.length) && !(l.walls?.length))
    && !(project?.rooms?.length) && !(project?.walls?.length);
}

// Задать угол вида режима (мутирует project). Вариант А: в пустом «Плане»
// оси дома встают по экрану (новое рисуется ровно); нарисованный дом не
// трогается. pivot — локальная точка дома, которая остаётся на месте.
// Возвращает { angle, axesChanged }.
export function setViewAngle(project, mode, deg, { pivot = null } = {}) {
  const key = modeKey(mode);
  const angle = normViewAngle(deg);
  project.settings = project.settings || {};
  project.settings.viewAngles = { ...(cleanViewAngles(project.settings.viewAngles) || {}), [key]: angle };
  let axesChanged = false;
  if (key === 'plan' && isPlanEmpty(project)) {
    const b = project.building || { rotation: 0, origin: { x: 0, y: 0 } };
    const rot = rotationAlongLine(b.rotation || 0, angle);
    if (Math.abs(normDeg(rot) - normDeg(b.rotation || 0)) > 1e-9) {
      project.building = rotateBuildingAbout(b, pivot || { x: 0, y: 0 }, rot);
      axesChanged = true;
    }
  }
  return { angle, axesChanged };
}

// Сбросить угол режима к умолчанию (мутирует project).
export function resetViewAngle(project, mode) {
  const va = cleanViewAngles(project?.settings?.viewAngles);
  if (!va) { if (project?.settings) delete project.settings.viewAngles; return; }
  delete va[modeKey(mode)];
  if (Object.keys(va).length) project.settings.viewAngles = va;
  else delete project.settings.viewAngles;
}

// «Развернуть оси дома по виду»: поворот дома (ближайший из угол+k·90°),
// при котором его оси идут по экрану режима. null — уже по виду.
export function buildingAlignedToView(project, mode, pivot) {
  const b = project.building || { rotation: 0, origin: { x: 0, y: 0 } };
  const rot = rotationAlongLine(b.rotation || 0, viewAngle(project, mode));
  if (Math.abs(normDeg(rot) - normDeg(b.rotation || 0)) < 1e-6) return null;
  return rotateBuildingAbout(b, pivot || { x: 0, y: 0 }, rot);
}

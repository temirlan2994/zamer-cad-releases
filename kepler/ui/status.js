// Строка состояния: связность помещений.

import { isUpperLevel } from '../core/model.js';
import { analyzeConnectivity, suggestAccess } from '../core/rooms.js';
import { refs } from './dom.js';
import { state } from './state.js';

export function updateConnectivity() {
  const bar = refs.connectivity;
  if (!state.project.rooms.length) { bar.hidden = true; return; }
  const analysis = analyzeConnectivity(state.project, state.walls);
  const problems = [];
  const upper = isUpperLevel(state.project);
  if (!analysis.hasEntrance) {
    problems.push(upper
      ? 'Нет лестницы — добавьте помещение «Лестница» над лестницей этажа ниже'
      : 'Нет входной двери — добавьте дверь на наружной стене');
  }
  for (const roomId of analysis.unreachable) {
    const hint = suggestAccess(state.project, roomId, analysis);
    if (hint) problems.push(hint.text);
  }
  if (!problems.length) {
    bar.hidden = false;
    bar.className = 'status-strip ok';
    bar.textContent = upper ? '✓ Все помещения этажа доступны от лестницы' : '✓ Все помещения доступны от входа';
    bar.title = '';
  } else {
    bar.hidden = false;
    bar.className = 'status-strip warn';
    const text = `⚠ ${problems.join(' · ')}`;
    bar.textContent = problems.length > 1 ? `⚠ ${problems.length}: ${problems[0]}…` : text;
    bar.title = problems.join('\n'); // полный список по наведению
  }
}

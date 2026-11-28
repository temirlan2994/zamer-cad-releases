import { deriveWalls, openingRect } from './walls.js';
import { levelProject, sortedLevels } from './model.js';
import { openingHeight, openingSill } from './opening-preset.js';
import { nextWindowSpan, windowSpanTop } from './spanning-windows.js';
import { wallZRange } from './wall-z-range.js';

export function auditModelLinks(project) {
  const findings = [], allIds = new Set(), levels = sortedLevels(project), levelIds = new Set(levels.map((level) => level.id));
  const add = (id, title, levelId, target = null, status = 'error') => findings.push({ id, title, levelId, target, status });
  for (const level of levels) {
    if (![level.elevation, level.height, level.slabThickness].every(Number.isFinite) || level.height <= 0) add(`level:${level.id}`, 'Некорректные размеры этажа', level.id);
    const lp = levelProject(project, level.id), walls = deriveWalls(lp), rooms = new Set(level.rooms.map((room) => room.id));
    for (const object of [level, ...level.rooms, ...level.openings, ...level.items, ...(level.walls || [])]) {
      if (!object.id || allIds.has(object.id)) add(`duplicate:${level.id}:${object.id}`, `Повторяющийся или пустой идентификатор: ${object.id || '—'}`, level.id);
      allIds.add(object.id);
    }
    for (const opening of level.openings) {
      const target = { type: 'opening', id: opening.id }, placed = openingRect(lp, opening, walls);
      if (!placed || opening.orphan) { add(`opening:${opening.id}`, 'Проём потерял стену', level.id, target); continue; }
      if (opening.span && windowSpanTop(project, level.id, opening) == null) add(`span:${opening.id}`, 'Связь окна со стеной верхнего этажа нарушена', level.id, target);
      const top = openingSill(opening, level)+openingHeight(opening, level), wall = wallZRange(lp, placed.wall, level.height);
      if (top > wall.z1+1 && !windowSpanTop(project, level.id, opening) && !nextWindowSpan(project, level.id, opening)) add(`height:${opening.id}`, 'Высота проёма выходит за стену; продолжение на верхнем этаже недоступно', level.id, target);
    }
    for (const room of level.rooms) if (room.parentId && !rooms.has(room.parentId)) add(`parent:${room.id}`, 'Родитель помещения не найден', level.id, { type: 'room', id: room.id });
    for (const item of level.items) if (item.kind === 'stairs' && item.toLevel && item.toLevel !== 'none' && !levelIds.has(item.toLevel)) add(`stairs:${item.id}`, 'Лестница ведёт на удалённый этаж', level.id, { type: 'item', id: item.id });
  }
  for (const mass of project.masses || []) {
    const host = mass.facadeHost;
    if (host && !levels.find((level) => level.id === host.levelId)?.rooms.some((room) => room.id === host.roomId)) add(`facade:${mass.id}`, 'Фасадный элемент потерял привязку к комнате', host.levelId, { type: 'mass', id: mass.id });
  }
  for (const roof of project.roofs || []) if (!levelIds.has(roof.levelId)) add(`roof:${roof.id}`, 'Кровля связана с удалённым этажом', roof.levelId, { type: 'roof', id: roof.id });
  return { status: findings.some((entry) => entry.status === 'error') ? 'blocked' : 'checked', findings };
}

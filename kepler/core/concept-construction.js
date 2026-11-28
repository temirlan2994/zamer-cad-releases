import { normalizeConstruction } from './concept-data.js';
import { buildHouseMesh } from './mesh3d.js';
import { sortedLevels } from './model.js';
import { isOpenRoom, isShaft } from './catalog.js';

function contains(points, x, y) {
  let inside = false;
  points.forEach((a, i) => {
    const b = points[(i+1)%points.length];
    if ((a.y > y) !== (b.y > y) && x < (b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x) inside = !inside;
  });
  return inside;
}

export function analyzeConstructability(project, { mesh = null } = {}) {
  const config = normalizeConstruction(project.concept?.construction), findings = [];
  const add = (id, status, title, target = null, levelId = null) => findings.push({ id, status, title, target, levelId });
  if (config.system === 'unknown') add('system', 'unknown', 'Выберите конструктивную систему дома');
  if (!config.maxSpan) add('span-limit', 'unknown', 'Допустимый пролёт не задан инженером; проверка пролётов не выполнена');
  if (!config.soil) add('soil', 'unknown', 'Не заданы сведения о грунтах и основании');
  if (!config.engineer || !config.source) add('engineering-review', 'unknown', 'Не указаны инженер и источник конструктивных ограничений');
  const thickness = config.layers.reduce((sum, layer) => sum+layer.thickness, 0);
  if (!thickness) add('layers', 'unknown', 'Не задан состав наружной стены');
  else if (Math.abs(thickness-(project.settings?.exterior || 250)) > 1) add('layers-thickness', 'attention', `Состав стены ${thickness} мм отличается от стандартной геометрической толщины ${project.settings?.exterior || 250} мм`);
  const levels = sortedLevels(project);
  levels.forEach((level, i) => {
    if (i && level.elevation < levels[i-1].elevation+levels[i-1].height-1) add(`level-overlap:${level.id}`, 'attention', 'Верх нижнего этажа пересекает отметку следующего: проверьте высоты стен', null, level.id);
    for (const room of level.rooms) {
      const target = { type: 'room', id: room.id };
      if (config.maxSpan && !isOpenRoom(room) && !isShaft(room) && Math.min(room.w, room.h) > config.maxSpan) add(`span:${room.id}`, 'attention', `${room.name}: меньший габарит помещения больше заданного пролёта ${config.maxSpan} мм; проверьте опирание`, target, level.id);
      if (room.type === 'balcony') add(`balcony:${room.id}`, 'unknown', `${room.name}: требуется решение по опиранию и ограждению`, target, level.id);
    }
  });
  const hasStairs = levels.some((level) => level.items.some((item) => item.kind === 'stairs'));
  if (hasStairs) {
    const faces = mesh || buildHouseMesh(project, { roof: true, landscape: false, facades: false });
    const overhead = faces.filter((face) => ['slab', 'roof-soffit'].includes(face.kind) && face.normal.z < -.1);
    const blocked = new Map();
    for (const tread of faces.filter((face) => face.kind === 'stairs' && face.itemId && ['tread', 'landing'].includes(face.part) && face.normal.z > .5)) {
      const point = tread.pts.reduce((sum, p) => ({ x: sum.x+p.x/tread.pts.length, y: sum.y+p.y/tread.pts.length, z: sum.z+p.z/tread.pts.length }), { x: 0, y: 0, z: 0 });
      for (const ceiling of overhead) {
        if (!contains(ceiling.pts, point.x, point.y)) continue;
        const p = ceiling.pts[0], n = ceiling.normal;
        const z = p.z-(n.x*(point.x-p.x)+n.y*(point.y-p.y))/n.z, gap = z-point.z;
        if (gap > .5 && gap < config.minHeadroom && gap < (blocked.get(tread.itemId)?.gap ?? Infinity)) blocked.set(tread.itemId, { gap, levelId: tread.level });
      }
    }
    for (const [id, item] of blocked) add(`headroom:${id}`, 'blocked', `Над ступенью найдено ${Math.round(item.gap)} мм до перекрытия/кровли при заданном просвете ${config.minHeadroom} мм`, { type: 'item', id }, item.levelId);
  }
  return { config, findings, status: findings.some((entry) => entry.status === 'blocked') ? 'blocked'
    : findings.some((entry) => entry.status === 'attention') ? 'attention' : findings.some((entry) => entry.status === 'unknown') ? 'unknown' : 'checked',
    scope: 'Геометрические проверки и введённые ограничения. Расчёт несущей способности, узлы и проект инженера остаются отдельной приёмкой.' };
}

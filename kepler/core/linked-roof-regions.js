// Доступное пятно кровли в координатах дома. План, 3D и экспорт используют
// одинаковую область за вычетом верхних помещений и самостоятельных крыш.
import { northInBuilding } from './building.js';
import { isOpenRoom } from './catalog.js';
import { envelopeOf } from './envelope.js';
import { difference, intersection } from './geom/clip.js';
import { area, bbox, boxesOverlap } from './geom/poly.js';
import { sortedLevels } from './model.js';
import { mergeCells, traceCycles } from './ortho-grid.js';
import { roomRects } from './room-shape.js';
import {
  FASCIA_T, canHaveLinkedRoof, expandRects, linkedRoofGroups, pointInOutline, rectGrid, rectsBox,
  roofIsSlanted, roofRects, roofSlabOutline,
} from './roofs.js';

export function gridRoofRects(grid) {
  const labels = Int8Array.from(grid.mask, (filled) => filled ? 0 : -1);
  return (mergeCells(labels, grid.xs, grid.ys).get(0) || [])
    .map((r) => ({ x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.h }));
}

export function gridOutline(grid) {
  const cycles = traceCycles(grid.mask, grid.xs, grid.ys);
  const polygons = cycles.filter((cycle) => cycle.area > 0).sort((a, b) => a.area - b.area).map(({ pts }) => [pts]);
  for (const { pts, area: signed } of cycles) {
    if (signed >= 0) continue;
    const parent = polygons.find(([outer]) => pointInOutline(outer, pts[0].x, pts[0].y));
    if (parent) parent.push(pts);
  }
  return polygons;
}

function footprint(rooms, outset) {
  return rooms.flatMap(roomRects).map((p) => ({
    x0: p.x - outset, x1: p.x + p.w + outset, y0: p.y - outset, y1: p.y + p.h + outset,
  }));
}

export function linkedRoofRegions(project) {
  if (!project) return [];
  const envelope = envelopeOf(project);
  const groups = linkedRoofGroups(project);
  if (!groups.length) return [];
  const { roof } = envelope;
  const angle = northInBuilding(project.site?.north, project.building) + ({ n: 0, e: 90, s: 180, w: 270 }[roof.direction] || 0);
  const direction = roof.direction === 'auto' ? 'auto' : ['n', 'e', 's', 'w'][(Math.round(angle / 90) % 4 + 4) % 4];
  const levels = sortedLevels(project);
  const built = levels.map((level) => footprint(level.rooms.filter(canHaveLinkedRoof), project.settings?.exterior || 250)
    .concat(footprint(level.rooms.filter((room) => !room.parentId && isOpenRoom(room)), 0)));
  const result = [];
  levels.forEach((level, index) => {
    const local = groups.filter((g) => g.levelId === level.id);
    if (!local.length) return;
    const manual = (project.roofs || []).filter((r) => r.levelId === level.id);
    const cuts = built.slice(index + 1).flat().concat(
      footprint(level.rooms.filter((r) => canHaveLinkedRoof(r) && r.linkedRoof === false), 0),
      manual.filter((r) => !roofIsSlanted(r)).flatMap((r) => roofRects(project, r)),
    );
    const angled = manual.filter(roofIsSlanted).map((r) => roofSlabOutline(project, r));
    // При близко стоящих корпусах карнизы могут встретиться. Забираем их
    // общую полосу один раз; стены второго корпуса всегда остаются его крыше.
    const taken = [];
    const levelStart = result.length;
    for (const group of local) {
      const box = expandRects([rectsBox(group.baseRects)], roof.overhang)[0];
      const trimPad = roof.type === 'flat' ? FASCIA_T : 1;
      const blocked = cuts.concat(taken, local.filter((g) => g !== group).flatMap((g) => g.baseRects))
        .filter((r) => boxesOverlap(box, r, trimPad));
      const oblique = angled.filter((ring) => boxesOverlap(box, bbox(ring), trimPad));
      const exposed = rectGrid([group.baseRects], blocked);
      if (!exposed.mask.includes(1)) continue;
      if (oblique.length && !difference(gridOutline(exposed), ...oblique).length) continue;
      // Свес растёт только от оставшейся опоры. При полном совпадении этажей
      // кольцо по периметру нижнего этажа не возникает.
      const grid = roof.overhang ? rectGrid([expandRects(gridRoofRects(exposed), roof.overhang)], blocked) : exposed;
      const original = gridOutline(grid);
      const affected = oblique.filter((ring) => intersection(original, ring).length);
      const outline = affected.length ? difference(original, ...affected) : original;
      if (!outline.length) continue;
      const planArea = area(outline);
      let slopeGrid = grid;
      if (roof.type !== 'flat' && (blocked.length || affected.length)) {
        // Надстройка обрезает существующие плоскости, не поворачивая конёк
        // и не перенося отметки оставшегося ската.
        const uncut = rectGrid([expandRects(group.baseRects, roof.overhang)]);
        if (area(gridOutline(uncut)) > planArea + 0.5) slopeGrid = rectGrid([gridRoofRects(uncut)]);
      }
      result.push({ ...group, grid, slopeGrid, outline, planArea, blocked, oblique: affected, trimOblique: oblique,
        z: level.elevation + level.height, thickness: envelope.roofThickness, roofType: roof.type,
        material: roof.material, parapetHeight: roof.type === 'flat' ? roof.parapetHeight : 0,
        pitchDeg: roof.type === 'flat' ? 0 : roof.pitchDeg, direction, overhang: roof.overhang, drainage: roof.drainage });
      if (roof.overhang && local.length > 1) taken.push(...gridRoofRects(grid));
    }
    // Свесы раздельных корпусов могут соприкасаться без общей стены.
    // На этой границе детали края не должны перекрываться ни с одной стороны.
    const peers = result.slice(levelStart);
    if (roof.type === 'flat' && roof.overhang && peers.length > 1) {
      const covers = peers.map((region) => gridRoofRects(region.grid));
      peers.forEach((region, index) => {
        const box = rectsBox(covers[index]);
        region.trimBlocked = region.blocked.concat(covers.flatMap((rects, i) =>
          i === index ? [] : rects.filter((rect) => boxesOverlap(box, rect, FASCIA_T))));
      });
    }
  });
  return result;
}

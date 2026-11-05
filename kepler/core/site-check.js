// Дом на участке: сдвиг дома целиком и постоянная проверка его положения
// (зона застройки, отступ до соседних домов). Чистый модуль без DOM.
//
// Комнаты лежат в осях дома, участок — в координатах съёмки (core/building.js):
// сдвиг дома меняет только building.origin, комнаты не трогаются.

import { DEFAULT_EXTERIOR, isShaft } from './catalog.js';
import { createBuilding, normDeg, rectCornersWorld } from './building.js';
import {
  DEFAULT_SETBACK_NEIGHBOR, buildZonePolygon, distanceToPolyline, neighborRectCorners,
} from './site.js';
import { pointInPolygon } from './zamer/geometry.js';

// Новый дом, сдвинутый в мире на (dx, dy) мм. Поворот не меняется.
export function moveBuilding(b, dx, dy) {
  const base = b || createBuilding();
  return {
    ...base,
    rotation: normDeg(base.rotation),
    origin: { x: (base.origin?.x || 0) + (Number(dx) || 0), y: (base.origin?.y || 0) + (Number(dy) || 0) },
  };
}

// Новый дом с заданной мировой точкой origin (x, y — мм).
export function setBuildingOrigin(b, x, y) {
  const base = b || createBuilding();
  return moveBuilding(base, (Number(x) || 0) - (base.origin?.x || 0), (Number(y) || 0) - (base.origin?.y || 0));
}

// Вид «План» хранится как вид мира ({ scale, rotation (рад), panX, panY }).
// Если дом сдвинули на (dx, dy) в мире, сдвигаем и вид, чтобы дом остался на
// том же месте экрана — в «Плане» сдвиг по участку незаметен.
export function panForMovedBuilding(view, dx, dy) {
  const phi = view.rotation || 0;
  const c = Math.cos(phi);
  const s = Math.sin(phi);
  return {
    panX: view.panX - (dx * c - dy * s) * view.scale,
    panY: view.panY - (dx * s + dy * c) * view.scale,
  };
}

// Комнаты верхнего уровня всех этажей (без шахт) — то, что стоит на участке.
function footprintRooms(project) {
  const levels = project.levels?.length ? project.levels : [{ rooms: project.rooms || [] }];
  return levels.flatMap((l) => l.rooms || []).filter((r) => !r.parentId && !isShaft(r));
}

// Пятно дома в мире: для каждой комнаты верхнего уровня — 4 угла её
// наружного габарита (с наружными стенами), с учётом поворота и сдвига дома.
export function buildingFootprint(project) {
  const t = project.settings?.exterior || DEFAULT_EXTERIOR;
  return footprintRooms(project).map((r) => ({
    roomId: r.id,
    corners: rectCornersWorld(project.building, { x: r.x - t, y: r.y - t, w: r.w + 2 * t, h: r.h + 2 * t }),
  }));
}

// Попадание мировой точки в пятно дома (за любую комнату).
export function pointInBuilding(project, p) {
  return buildingFootprint(project).some((f) => pointInPolygon(p, f.corners));
}

function segDist(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function cross(o, a, b) {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function segsCross(a, b, c, d) {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return Boolean(((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0)) && d1 && d2 && d3 && d4);
}

// Кратчайшее расстояние между двумя многоугольниками (0 — касаются/пересекаются).
export function polygonsDistance(a, b) {
  if (a.some((p) => pointInPolygon(p, b)) || b.some((p) => pointInPolygon(p, a))) return 0;
  let best = Infinity;
  for (let i = 0; i < a.length; i += 1) {
    const a1 = a[i];
    const a2 = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j += 1) {
      const b1 = b[j];
      const b2 = b[(j + 1) % b.length];
      if (segsCross(a1, a2, b1, b2)) return 0;
      best = Math.min(best, segDist(a1, b1, b2), segDist(a2, b1, b2), segDist(b1, a1, a2), segDist(b2, a1, a2));
    }
  }
  return best;
}

const fmtM = (mm) => (Math.round(mm / 10) / 100).toLocaleString('ru-RU');

// Положение дома на участке.
//   zoneOverflow — на сколько мм дом выходит за зону застройки (0 — внутри;
//     null — границы участка нет; Infinity — зоны нет, отступ съел участок);
//   neighborGap — до ближайшего соседнего дома, мм (null — соседей нет);
//   issues — строки для статуса/панели; ok — замечаний нет.
// Для выпуклой зоны максимум выхода достигается в углу пятна, поэтому
// достаточно проверить углы (для вогнутой — приближение).
export function buildingSiteCheck(project) {
  const site = project.site || {};
  const footprint = buildingFootprint(project);
  const result = {
    zoneOverflow: null, neighborGap: null, neighborId: null,
    neighborLimit: site.setbackNeighbor ?? DEFAULT_SETBACK_NEIGHBOR,
    issues: [], ok: true, footprint,
  };
  if (!footprint.length) return result;

  if (site.boundary?.length >= 3) {
    const zone = buildZonePolygon(site);
    if (!zone || zone.length < 3) {
      result.zoneOverflow = Infinity;
      result.issues.push('Отступ от границы съедает весь участок — зоны застройки нет');
    } else {
      let over = 0;
      for (const f of footprint) {
        for (const c of f.corners) {
          if (!pointInPolygon(c, zone)) over = Math.max(over, distanceToPolyline(zone, c, true));
        }
      }
      result.zoneOverflow = Math.round(over);
      if (result.zoneOverflow >= 1) {
        result.issues.push(`Дом выходит за зону застройки на ${result.zoneOverflow} мм`);
      }
    }
  }

  for (const n of site.neighbors || []) {
    const nc = neighborRectCorners(n);
    for (const f of footprint) {
      const d = polygonsDistance(f.corners, nc);
      if (result.neighborGap === null || d < result.neighborGap) {
        result.neighborGap = d;
        result.neighborId = n.id;
      }
    }
  }
  if (result.neighborGap !== null && result.neighborGap < result.neighborLimit - 0.5) {
    result.issues.push(`До соседа ${fmtM(result.neighborGap)} м < ${fmtM(result.neighborLimit)} м`);
  }
  result.ok = result.issues.length === 0;
  return result;
}

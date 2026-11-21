// Микроступеньки стен (core/walls-v2.js, JOG_TOL): помещения со сдвигом
// 10–50 мм не дают ступенек, зубцов и выступов в теле стен. Данные — вырезка
// из проекта пользователя 2026-11-09 (этаж 1, kepler-plan/7).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { deserializeProject, levelProject } from '../core/model.js';
import { deriveWalls, openingRect, wallOutline, wallRects, wallsEngine } from '../core/walls.js';
import { JOG_TOL } from '../core/walls-v2.js';
import { checkWallJogs } from './wall-invariants-lib.mjs';
import { mixedThicknessNode } from './wall-fixtures.mjs';

const file = readFileSync(new URL('./fixtures/user-house-joints-2026-11.kepler.json', import.meta.url), 'utf8');
const project = deserializeProject(file);
const level = levelProject(project, project.levels[0].id);
const walls = deriveWalls(level);
const room = (name) => level.rooms.find((r) => r.name === name);

// Видимые куски стен, пересекающие окно (строго внутри, мм).
function visibleIn(box) {
  const out = [];
  for (const w of walls) {
    if (w.hidden) continue;
    for (const r of wallRects(w)) {
      const ix = Math.min(r.x + r.w, box.x + box.w) - Math.max(r.x, box.x);
      const iy = Math.min(r.y + r.h, box.y + box.h) - Math.max(r.y, box.y);
      if (ix > 0.5 && iy > 0.5) out.push(`${w.key} ${r.x},${r.y} ${r.w}×${r.h}`);
    }
  }
  return out;
}

// Вершины контура видимых стен.
function outlineHas(x, y) {
  return wallOutline(walls).some((c) => c.pts.some((p) => Math.abs(p.x - x) < 0.6 && Math.abs(p.y - y) < 0.6));
}

test('файл пользователя: этаж 1 считается движком v2', () => {
  assert.equal(wallsEngine(level), 'v2');
  assert.equal(JOG_TOL, 50);
  for (const name of ['Коридор 2', 'Постирочная', 'Гостиная', 'Холл', 'Гардеробная — копия', 'Санузел', 'Спальня']) {
    assert.ok(room(name), name);
  }
});

test('файл пользователя: в контуре стен нет рёбер короче 50 мм', () => {
  const r = checkWallJogs(walls);
  assert.ok(r.ok, `${r.count}: ${r.sample.join('; ')}`);
});

test('угол Гостиная/Холл/Гардеробная: над Т-узлом нет выступа в зоне скрытой стены', () => {
  // Раньше: тёмный выступ 100×150 (−60…40, −13642…−13492) от углового
  // прямоугольника вогнутой вершины и стены 10-мм ребра Гостиной.
  assert.deepEqual(visibleIn({ x: -60, y: -13700, w: 110, h: 232 }), []);
  // Т-узел на месте: вертикальная стена Гостиная|Гардеробная доходит до
  // верхней грани стены Холл|Гардеробная.
  assert.ok(visibleIn({ x: -50, y: -13460, w: 90, h: 80 }).length > 0);
});

test('Постирочная: правая грань — одна прямая (сдвиг 16 мм закрыт стеной)', () => {
  const p = room('Постирочная');
  assert.ok(p.outline, 'у комнаты есть сдвиг грани');
  assert.equal(outlineHas(12700, -11000), false);
  assert.equal(outlineHas(12684, -11000), false);
});

test('низ Спальни/Санузла/Постирочной (−10353/−10342/−10357): наружная грань заподлицо', () => {
  // Ни одной вершины контура вдоль низа — грань одна прямая на −10092.
  const pts = wallOutline(walls).flatMap((c) => c.pts);
  assert.deepEqual(pts.filter((p) => p.x > 2000 && p.x < 12000 && p.y > -10200 && p.y < -10000), []);
  const edge = wallOutline(walls).some((c) => c.pts.some((a, i) => {
    const b = c.pts[(i + 1) % c.pts.length];
    return a.y === -10092 && b.y === -10092 && Math.min(a.x, b.x) < 2045 && Math.max(a.x, b.x) > 12700;
  }));
  assert.ok(edge, 'нет прямой наружной грани на −10092');
});

test('проём режет тело стены насквозь и там, где грань выровнена по ступеньке', () => {
  let widened = 0;
  for (const o of level.openings) {
    const placed = openingRect(level, o, walls);
    if (!placed) continue;
    const { rect, wall } = placed;
    const h = wall.orient === 'h';
    if ((h ? rect.h : rect.w) > (h ? wall.band.h : wall.band.w) + 0.5) widened += 1;
    for (const r of wallRects(wall)) {
      const along = h ? Math.min(r.x + r.w, rect.x + rect.w) - Math.max(r.x, rect.x) : Math.min(r.y + r.h, rect.y + rect.h) - Math.max(r.y, rect.y);
      if (along <= 0.5) continue;
      const [cl, ch, ol, oh] = h ? [r.y, r.y + r.h, rect.y, rect.y + rect.h] : [r.x, r.x + r.w, rect.x, rect.x + rect.w];
      assert.ok(cl >= ol - 0.5 && ch <= oh + 0.5, `${o.id}: тело ${cl}…${ch} шире проёма ${ol}…${oh}`);
    }
  }
  assert.ok(widened > 0, 'в файле есть проём на выровненной стене');
});

test('разная заданная толщина (300 и 250) — уступ сохраняется: это замысел, не шум', () => {
  const p = mixedThicknessNode();
  const top = deriveWalls(p).filter((w) => !w.hidden).flatMap(wallRects)
    .filter((r) => r.y < 0 && r.y + r.h <= 0.5);
  const ys = new Set(top.map((r) => r.y));
  assert.ok(ys.has(-300) && ys.has(-250), [...ys].join(','));
});

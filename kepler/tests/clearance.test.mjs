// Проходы у мебели и ТЭП.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createRoom, createOpening, createItem, createLevel } from '../core/model.js';
import { deriveWalls } from '../core/walls.js';
import { furnitureIssues, itemBounds } from '../core/clearance.js';
import { tepReport, tepRows } from '../core/tep.js';

// Комната 5×4 м, дверь внизу у левого края (открывается внутрь).
function room() {
  const p = createProject();
  const r = createRoom('living', 0, 0, 5000, 4000);
  p.rooms.push(r);
  p.openings.push(createOpening('door', r.id, 2, 700, 800));
  return { p, r };
}
const issues = (p, r) => furnitureIssues(p, r, deriveWalls(p)).map((i) => i.kind).sort();

test('габарит повёрнутого предмета', () => {
  const b = itemBounds({ x: 0, y: 0, w: 2000, h: 1000, rotation: 90 });
  assert.deepEqual([Math.round(b.w), Math.round(b.h)], [1000, 2000]);
  const d = itemBounds({ x: 0, y: 0, w: 1000, h: 1000, rotation: 45 });
  assert.ok(Math.abs(d.w - 1414.2) < 1);
});

test('свободная комната — без замечаний', () => {
  const { p, r } = room();
  p.items.push(createItem('sofa', 2500, 600, 2200, 950));
  assert.deepEqual(issues(p, r), []);
});

test('пересечение, дверь, недоступный предмет', () => {
  const { p, r } = room();
  p.items.push(createItem('sofa', 2500, 600, 2200, 950), createItem('sofa-2', 2800, 900, 1600, 900));
  assert.deepEqual(issues(p, r), ['overlap']);

  const b = room();
  b.p.items.push(createItem('wardrobe', 700, 3600, 1200, 600)); // прямо перед дверью
  assert.ok(issues(b.p, b.r).includes('door'));

  // Кровать в правом верхнем углу отрезана шкафами (щели 200–300 мм < 600,
  // нижний шкаф закрывает и угол).
  const c = room();
  c.p.items.push(
    createItem('bed-double', 4100, 1000, 1600, 2000),
    createItem('wardrobe', 2800, 1000, 600, 2000), // слева от кровати, вплотную к стене
    createItem('wardrobe', 3700, 2600, 2400, 600), // под кроватью и под левым шкафом
  );
  const k = issues(c.p, c.r);
  assert.ok(k.includes('reach'), k.join(','));
});

test('ТЭП: участок, застройка, коэффициенты, объём, этажность', () => {
  const p = createProject();
  p.site.boundary = [{ x: -5000, y: -5000 }, { x: 15000, y: -5000 }, { x: 15000, y: 15000 }, { x: -5000, y: 15000 }];
  p.rooms.push(createRoom('living', 0, 0, 5000, 4000));
  p.levels.push(createLevel('2 этаж', 3000, 2800, 'L2'));
  p.activeLevel = 'L2';
  p.rooms.push(createRoom('bedroom', 0, 0, 5000, 4000));
  const t = tepReport(p);
  const fp = (5500 * 4500) / 1e6; // с наружными стенами по 250
  assert.equal(t.plot, 400);
  assert.ok(Math.abs(t.footprint - fp) < 1e-9);
  assert.ok(Math.abs(t.coverage - fp / 400) < 1e-9);
  assert.ok(Math.abs(t.density - (2 * fp) / 400) < 1e-9);
  assert.ok(Math.abs(t.volume - fp * (3 + 2.8)) < 1e-9);
  assert.deepEqual([t.storeys, t.height], [2, 5.8]);
  assert.ok(Math.abs(t.living - 40) < 1e-9);
  const rows = Object.fromEntries(tepRows(t));
  assert.equal(rows['Коэффициент застройки'], '6,2 %');
  assert.equal(rows['Этажность / высота'], '2 · 5,80 м');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { entryParts } from '../core/site-entries.js';
import { entryWorldPoint, resizeSiteEntry, siteEntryHandles, toggleEntryOpening } from '../core/site-entry-handles.js';

const gate = () => ({ id: 'g', kind: 'gate', opening: 'swing', width: 4000, height: 1800, x: 6000, y: 0, dir: 90 });
const site = (entries) => ({ boundary: [{ x: 0, y: 0 }, { x: 24000, y: 0 }, { x: 24000, y: 18000 }, { x: 0, y: 18000 }], entries });

test('ручка меняет ширину, сохраняя противоположный торец и высоту', () => {
  const start = gate(); const s = site([start]);
  const end = resizeSiteEntry(s, start, 0, 'end', { x: 8500, y: 200 });
  assert.equal(end.width, 4500); assert.equal(end.height, 1800);
  assert.ok(Math.abs(entryWorldPoint(end, -end.width / 2).x - 4000) < 1);
  const left = resizeSiteEntry(s, start, 0, 'start', { x: 3500, y: -200 });
  assert.equal(left.width, 4500);
  assert.ok(Math.abs(entryWorldPoint(left, left.width / 2).x - 8000) < 1);
  assert.deepEqual(start, gate(), 'предпросмотр не мутирует исходный объект');
});
test('угол границы и соседние ворота ограничивают размер', () => {
  const start = gate(); const other = { ...gate(), id: 'neighbor', x: 12000 };
  assert.equal(resizeSiteEntry(site([start]), start, 0, 'start', { x: 0, y: 0 }), null);
  assert.equal(resizeSiteEntry(site([start, other]), start, 0, 'end', { x: 13000, y: 0 }), null);
  assert.equal(resizeSiteEntry(site([start]), start, 0, 'end', { x: 8521, y: 0 }, 1).width, 4521);
});
test('боковая калитка имеет наружную ручку: её изменение не двигает ворота', () => {
  for (const side of ['left', 'right']) {
    const start = { ...gate(), wicket: true, wicketWidth: 1000, wicketSide: side };
    const part = entryParts(start)[1];
    const handle = siteEntryHandles(start).find((h) => h.part === 1);
    const sign = side === 'left' ? -1 : 1;
    const point = entryWorldPoint(start, part.offset + sign * (part.width / 2 + 200));
    const resized = resizeSiteEntry(site([start]), start, 1, handle.end, point);
    assert.equal(resized.wicketWidth, 1200);
    assert.deepEqual([resized.x, resized.y, resized.width], [start.x, start.y, start.width]);
    assert.equal(siteEntryHandles(start).length, 3);
  }
});
test('калитка на вертикальной стороне растягивается вдоль границы, с шагом 50 мм', () => {
  const start = { ...gate(), kind: 'wicket', width: 1000, x: 0, y: 5000, dir: 0 };
  const h = siteEntryHandles(start).find((p) => p.end === 'end');
  const next = resizeSiteEntry(site([start]), start, 0, 'end', { x: h.x + 100, y: h.y - 225 });
  assert.equal(next.width, 1250); assert.equal(next.x, 0);
  assert.ok(Math.abs(entryWorldPoint(next, -next.width / 2).y - 5500) < 1);
});
test('круглые кнопки отдельно меняют направление и петли основного и бокового полотна', () => {
  const start = { ...gate(), opening: 'sliding', wicket: true, wicketOpening: 'swing', wicketWidth: 1000 };
  const slide = toggleEntryOpening(start, 0, 'direction');
  assert.equal(slide.slideDirection, 'left'); assert.equal(slide.wicketSwingSide, undefined);
  const outside = toggleEntryOpening(slide, 1, 'direction');
  const hinge = toggleEntryOpening(outside, 1, 'hinge');
  assert.equal(hinge.wicketSwingSide, 'outside'); assert.equal(hinge.wicketHinge, 'right');
  assert.equal(hinge.slideDirection, 'left'); assert.equal(hinge.dir, 90); assert.equal(hinge.width, 4000);
  assert.equal(toggleEntryOpening(start, 0, 'hinge'), null);
  assert.equal(toggleEntryOpening(start, 3, 'direction'), null);
});

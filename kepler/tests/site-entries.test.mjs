import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, deserializeProject, serializeProject } from '../core/model.js';
import { ENTRY_CATEGORIES, ensureSiteEntries, entryAt, entryLandscapeObjects, entryOpeningSymbol, entryOverlaps, entryParts, entryPresets, normalizeSiteEntries, siteEntries, syncPrimaryEntry } from '../core/site-entries.js';
import { landscapeFaces } from '../core/mesh3d-landscape.js';
import { pickFaces } from '../core/pick3d.js';
import { buildStructuredExport } from '../core/export.js';

const site = () => ({ boundary: [{ x: 0, y: 0 }, { x: 24000, y: 0 }, { x: 24000, y: 18000 }, { x: 0, y: 18000 }], entries: [] });
const gate = (id, x = 6000) => ({ id, kind: 'gate', x, y: 0, dir: 90, width: 4000, height: 1800, wicket: false, wicketWidth: 1000, wicketSide: 'right' });

test('каталог въезда содержит размерные пресеты для всех категорий ворот и калиток', () => {
  const ids = new Set();
  for (const cat of ENTRY_CATEGORIES) {
    const items = entryPresets(cat.id);
    assert.equal(items.length, 4);
    for (const item of items) {
      assert.ok(!ids.has(item.id)); ids.add(item.id);
      assert.equal(item.kind, cat.id.startsWith('wicket') ? 'wicket' : 'gate');
      assert.equal(item.opening, cat.id.endsWith('sliding') ? 'sliding' : 'swing');
      assert.ok(entryAt(site(), { x: 12000, y: 0 }, item));
    }
  }
});

test('старый въезд становится воротами, направление dir/angle сохраняется', () => {
  for (const entry of [{ x: 6000, y: 0, dir: -90 }, { x: 6000, y: 0, angle: 90 }]) {
    const s = { ...site(), entry };
    const list = ensureSiteEntries(s);
    assert.equal(list.length, 1);
    assert.equal(list[0].dir, entry.dir ?? entry.angle);
    assert.equal(list[0].opening, 'swing');
    assert.equal(s.entry, list[0]);
  }
});
test('несколько ворот и калитка сохраняются в файле и структурированном экспорте', () => {
  const p = createProject('Ворота');
  Object.assign(p.site, site());
  p.site.entries = [gate('g1'), gate('g2', 16000), { ...gate('w', 21000), kind: 'wicket', width: 1000 }];
  p.site.entries[1].wicket = true;
  p.site.entries[1].opening = 'sliding';
  syncPrimaryEntry(p.site);
  const loaded = deserializeProject(serializeProject(p));
  assert.deepEqual(loaded.site.entries, normalizeSiteEntries(p.site));
  assert.equal(loaded.site.entry.id, 'g1');
  assert.equal(loaded.site.entries[1].opening, 'sliding');
  assert.equal(buildStructuredExport(loaded).site.entries.length, 3);
  loaded.site.entries.splice(0, 1); syncPrimaryEntry(loaded.site);
  assert.equal(loaded.site.entry.id, 'g2');
  loaded.site.entries.splice(0, 1); syncPrimaryEntry(loaded.site);
  assert.equal(loaded.site.entry, null, 'калитка не считается автомобильным въездом');
  assert.equal(siteEntries(loaded.site).length, 1);
});
test('боковая калитка меняет свой габарит и сторону, сохраняя ширину ворот', () => {
  const g = gate('g');
  assert.equal(entryParts(g).length, 1);
  g.wicket = true;
  const right = entryParts(g)[1];
  g.wicketSide = 'left';
  const left = entryParts(g)[1];
  assert.equal(right.offset, -left.offset);
  assert.equal(entryParts(g)[0].width, 4000);
  assert.equal(left.width, 1000);
});
test('габарит с калиткой помещается на стороне и не пересекает соседние ворота', () => {
  const s = site(); const g = { ...gate('g'), wicket: true };
  const nearCorner = entryAt(s, { x: 0, y: 0 }, g);
  assert.ok(nearCorner.x >= 2120);
  s.entries = [{ ...g, ...nearCorner }];
  assert.equal(entryOverlaps(s, { ...g, x: nearCorner.x + 1000 }), true);
  assert.equal(entryOverlaps(s, { ...g, x: 17000 }), false);
  assert.equal(entryOverlaps(s, s.entries[0], 'g'), false);
  const tiny = { boundary: [{ x: 0, y: 0 }, { x: 1500, y: 0 }, { x: 1500, y: 1500 }], entries: [] };
  assert.equal(entryAt(tiny, { x: 750, y: 0 }, g), null);
});
test('битые данные входов отбрасываются, ID уникальны', () => {
  const list = normalizeSiteEntries({ entries: [null, { x: 'oops', y: 2 }, gate('same'), gate('same')] });
  assert.equal(list.length, 2);
  assert.notEqual(list[0].id, list[1].id);
});
test('3D показывает обе створки, стойки и боковую калитку, выбирает исходные ворота', () => {
  const p = createProject('3D ворота');
  p.site.entries = [{ ...gate('g'), wicket: true }, { ...gate('w', 17000), kind: 'wicket', width: 1000 }];
  const objects = entryLandscapeObjects(p.site);
  assert.equal(objects.filter((o) => o.siteEntryId === 'g' && o.id.includes('leaf')).length, 3);
  const faces = landscapeFaces(p);
  assert.ok(faces.some((f) => f.siteEntryId === 'g'));
  assert.ok(faces.some((f) => f.siteEntryId === 'w'));
  assert.ok(pickFaces(faces).some((f) => f.pick?.type === 'site' && f.pick?.id === 'g'));
});

test('раздвижные ворота имеют одно полотно, боковая калитка остаётся отдельной створкой', () => {
  const s = site(); s.entries = [{ ...gate('slide'), opening: 'sliding', wicket: true }];
  const parts = entryLandscapeObjects(s).filter((o) => o.id.includes('leaf'));
  assert.equal(parts.length, 2);
  assert.equal(parts[0].w, 3965);
  assert.equal(parts[1].w, 965);
});

test('распашные створки открываются внутрь/наружу без поворота самого въезда', () => {
  const g = gate('swing'); const originalSpan = entryParts(g).map(({ offset, width }) => [offset, width]);
  const inside = entryOpeningSymbol(entryParts(g)[0]);
  g.swingSide = 'outside';
  const outside = entryOpeningSymbol(entryParts(g)[0]);
  assert.ok(inside.leaves.every((leaf) => leaf.tip.y > 0));
  assert.ok(outside.leaves.every((leaf) => leaf.tip.y < 0));
  assert.deepEqual(inside.leaves.map((leaf) => leaf.hinge), outside.leaves.map((leaf) => leaf.hinge));
  assert.deepEqual(entryParts(g).map(({ offset, width }) => [offset, width]), originalSpan);
  assert.equal(g.dir, 90);
});
test('калитка меняет сторону петель и направления сдвига', () => {
  const w = { ...gate('w'), kind: 'wicket', width: 1000 };
  const left = entryOpeningSymbol(entryParts(w)[0]).leaves[0];
  w.hinge = 'right';
  const right = entryOpeningSymbol(entryParts(w)[0]).leaves[0];
  assert.equal(left.hinge.x, -500); assert.equal(right.hinge.x, 500);
  assert.ok(left.tip.x > left.hinge.x); assert.ok(right.tip.x < right.hinge.x);
  w.opening = 'sliding'; w.slideDirection = 'left';
  const slideLeft = entryOpeningSymbol(entryParts(w)[0]);
  assert.equal(slideLeft.leaves.length, 0);
  assert.ok(slideLeft.slide.from.x > slideLeft.slide.to.x);
  w.slideDirection = 'right';
  const slideRight = entryOpeningSymbol(entryParts(w)[0]);
  assert.ok(slideRight.slide.from.x < slideRight.slide.to.x);
});
test('раздвижная калитка и направления ворот/боковой калитки сохраняются независимо', () => {
  const p = createProject('Направления');
  Object.assign(p.site, site());
  p.site.entries = [{ ...gate('g'), swingSide: 'outside', wicket: true, wicketOpening: 'sliding', wicketSlideDirection: 'left' },
    { ...gate('w', 17000), kind: 'wicket', width: 1000, opening: 'sliding', slideDirection: 'left', hinge: 'right', swingSide: 'outside' }];
  syncPrimaryEntry(p.site);
  const loaded = deserializeProject(serializeProject(p));
  const [g, w] = loaded.site.entries;
  assert.equal(g.swingSide, 'outside'); assert.equal(g.wicketOpening, 'sliding'); assert.equal(g.wicketSlideDirection, 'left');
  assert.equal(w.opening, 'sliding'); assert.equal(w.slideDirection, 'left'); assert.equal(w.hinge, 'right'); assert.equal(w.swingSide, 'outside');
  const parts = entryParts(g);
  assert.ok(entryOpeningSymbol(parts[0]).leaves.every((leaf) => leaf.tip.y < 0));
  assert.ok(entryOpeningSymbol(parts[1]).slide.from.x > entryOpeningSymbol(parts[1]).slide.to.x);
  assert.equal(buildStructuredExport(loaded).site.entries[1].slideDirection, 'left');
});

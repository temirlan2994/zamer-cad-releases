// Шаблоны домов: корректная расстановка, связность, окна наружу, нормы.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATES, buildTemplate } from '../core/templates.js';
import { deserializeProject, serializeProject, levelProject } from '../core/model.js';
import { analyzeConnectivity, validateRoomPlacement } from '../core/rooms.js';
import { deriveWalls, doorLink, openingRect } from '../core/walls.js';
import { normsReport } from '../core/norms.js';
import { slabOpeningArea, slabOpenings } from '../core/slab-openings.js';
import { levelWindowOpenings, windowSpanTop } from '../core/spanning-windows.js';
import { atriumRails } from '../core/atrium.js';
import { cornerWindowGeometry } from '../core/corner-windows.js';
import { fitOpeningOffset } from '../core/opening-spacing.js';
import { massBox } from '../core/masses.js';
import { stairLayout, stairParams, stairToPlan } from '../core/stairs.js';

for (const t of TEMPLATES) {
  test(`шаблон «${t.title}»: собирается и проходит проверки`, () => {
    const p = deserializeProject(serializeProject(buildTemplate(t.id)));
    for (const level of p.levels) {
      const lp = levelProject(p, level.id);
      const walls = deriveWalls(lp);
      for (const room of lp.rooms) {
        const v = validateRoomPlacement(lp, room, room.id);
        assert.ok(v.ok && !v.warning, `${level.name} / ${room.name}: ${v.reason || v.warning}`);
      }
      const c = analyzeConnectivity(lp, walls);
      assert.equal(c.hasEntrance, true, `${level.name}: нет входа`);
      assert.deepEqual(c.unreachable, [], `${level.name}: недоступны ${c.unreachable}`);
      for (const o of lp.openings) {
        const placed = openingRect(lp, o, walls);
        assert.ok(placed, `${level.name}: проём ${o.kind} вне стены`);
        if (o.kind === 'window') assert.equal(placed.wall.kind, 'own', `${level.name}: окно не на наружной стене`);
        if (o.kind === 'door') assert.ok(doorLink(lp, o, walls), `${level.name}: дверь ни с чем не связана`);
      }
    }
    const n = normsReport(p);
    assert.deepEqual(n.problems.map((x) => `${x.room.name}: ${x.text}`), []);
    assert.equal(n.insolation.ok, true, 'инсоляция');
  });
}

test('неизвестный шаблон — ошибка', () => {
  assert.throws(() => buildTemplate('nope'), /Нет шаблона/);
});

test('вилла сохраняет второй свет, лестницу, стеклянный балкон и выход в сад', () => {
  const p = deserializeProject(serializeProject(buildTemplate('garden-villa')));
  const [ground, upper] = p.levels;
  const atrium = ground.openings.find((o) => o.span);
  assert.equal(atrium.span.levelId, upper.id);
  assert.equal(atrium.frameMaterial, 'aluminum');
  const top = windowSpanTop(p, ground.id, atrium);
  assert.ok(top > upper.elevation + 2500);
  upper.height += 250;
  assert.equal(windowSpanTop(p, ground.id, atrium), top + 250);
  assert.ok(levelWindowOpenings(levelProject(p, upper.id)).some((o) => o.id === atrium.id && o.spanPart === 'upper'));
  const [voidOverHall] = slabOpenings(p, upper.id);
  const stair = ground.items.find((it) => it.id === voidOverHall.stairId);
  assert.equal(stair.toLevel, upper.id);
  assert.ok(slabOpeningArea(voidOverHall) > stair.w * stair.h);
  assert.equal(voidOverHall.atrium.windowId, atrium.id);
  const guards = atriumRails(p, upper.id, voidOverHall);
  const exit = stairToPlan(stair, stairLayout(stair).flights.at(-1).end);
  const halfWidth = stairParams(stair).fw / 2;
  const front = guards.filter(({ a, b }) => Math.abs(a.y - exit.y) < 1 && Math.abs(b.y - exit.y) < 1);
  const frontRanges = front.map(({ a, b }) => [Math.min(a.x, b.x), Math.max(a.x, b.x)]).sort((a, b) => a[0] - b[0]);
  assert.equal(frontRanges.length, 2);
  assert.deepEqual([frontRanges[0][1], frontRanges[1][0]], [exit.x - halfWidth, exit.x + halfWidth]);
  const balcony = upper.rooms.find((r) => r.type === 'balcony');
  assert.ok(balcony.railings.length >= 3 && balcony.railings.every((rail) => rail.type === 'glass'));
  assert.deepEqual(new Set(p.masses.map((m) => m.facadeKind).filter(Boolean)), new Set(['slats', 'stone', 'band', 'light', 'canopy']));
  const canopy = p.masses.find((m) => m.facadeKind === 'canopy');
  const strip = p.masses.find((m) => m.canopyId === canopy.id);
  assert.equal(massBox(strip).z1, canopy.z0);
  assert.equal(massBox(strip).y1, massBox(canopy).y1);
  assert.equal(strip.w, canopy.w);
  const corner = ground.openings.find((o) => o.corner);
  const walls = deriveWalls(p);
  const wings = cornerWindowGeometry(p, corner, walls);
  assert.deepEqual(wings.map((w) => [w.opening.side, w.opening.width]), [[2, 4150], [3, 3100]]);
  assert.equal(fitOpeningOffset(p, corner, walls, corner.offset), corner.offset);
  const stone = p.masses.find((m) => m.facadeKind === 'stone' && m.facadeHost.roomId === corner.roomId);
  assert.equal(massBox(stone).x0, wings[0].end);
  const objects = p.site.landscape.objects;
  assert.ok(objects.some((o) => o.kind === 'pond-area' && o.variant === 'mirror'));
  const gardenStair = objects.find((o) => o.kind === 'stairs-out');
  const terrace = ground.rooms.find((r) => r.type === 'terrace');
  assert.equal(gardenStair.elevTo, p.envelope.zeroAboveGround);
  assert.equal(gardenStair.y - gardenStair.h / 2, terrace.y + terrace.h);
});

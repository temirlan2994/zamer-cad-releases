// Тени по времени суток (core/landscape-shadow.js): солнце участка,
// направление и длина тени (с ограничением при низком солнце), тени
// деревьев, столбов, подпорных стенок (к низу/к верху), растений в коробе,
// дома по этажам, одна ориентация полигонов, подпись для кеша, сетка
// «солнечных часов» и сводка по клумбам; настройки вида (ui/landscape-style.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLandscapeObject } from '../core/landscape.js';
import { createProject, createRoom } from '../core/model.js';
import {
  SHADOW_MAX_RATIO, castsShadow, formatSunLabel, rumbOf, shadowPolys, shadowSignature, sunClass, sunForSite,
  sunHoursAt, sunHoursGrid, sunHoursSummary, sunRiseSet, withDirection,
} from '../core/landscape-shadow.js';
import { loadLandscapeSun, setLandscapeSun } from '../ui/landscape-style.js';
import { state } from '../ui/state.js';

const project = (...objects) => {
  const p = createProject();
  p.site.landscape.objects.push(...objects);
  return p;
};
// Солнце «вручную»: азимут и высота, север вверх.
const sunAt = (azimuth, altitude) => withDirection({ azimuth, altitude }, 0);
const area = (poly) => poly.reduce((s, a, i) => { const b = poly[(i + 1) % poly.length]; return s + a.x * b.y - b.x * a.y; }, 0) / 2;
// Наибольший вынос тени вдоль направления от точки c.
const reach = (polys, sun, c) => Math.max(...polys.flatMap((s) => s.poly.map((p) => (p.x - c.x) * sun.dir.x + (p.y - c.y) * sun.dir.y)));

test('направление тени: солнце на юге — тень на север (вверх, y < 0), на востоке — на запад', () => {
  const south = sunAt(180, 45);
  assert.ok(Math.abs(south.dir.x) < 1e-9 && south.dir.y < -0.999, 'солнце на юге → тень вверх');
  const east = sunAt(90, 30);
  assert.ok(east.dir.x < -0.999, 'солнце на востоке → тень влево');
  assert.ok(Math.abs(south.k - 1) < 1e-9, '45° → длина = высоте');
  // Север повёрнут на 90° по часовой: юг плана смотрит влево → тень вправо.
  const rot = withDirection({ azimuth: 180, altitude: 45 }, 90);
  assert.ok(rot.dir.x > 0.999);
});

test('солнце Алматы 21 июня: утро/вечер/полдень, восход-заход, румб', () => {
  const p = createProject();
  const morning = sunForSite(p.site, '2026-06-21', 7 * 60);
  const evening = sunForSite(p.site, '2026-06-21', 18 * 60 + 30);
  const noon = sunForSite(p.site, '2026-06-21', 12 * 60);
  assert.ok(morning.dir.x < -0.8, 'утром тень на запад');
  assert.ok(evening.dir.x > 0.8, 'вечером тень на восток');
  assert.ok(noon.dir.y < -0.8 && noon.altitude > 65, 'в полдень тень на север и короткая');
  assert.ok(noon.k < 0.5);
  const { rise, set } = sunRiseSet(p.site, '2026-06-21');
  assert.ok(rise > 3 * 60 && rise < 6 * 60 && set > 18 * 60 && set < 21 * 60);
  assert.equal(rumbOf(225), 'ЮЗ');
  assert.equal(rumbOf(359), 'С');
  // Ночью солнца нет — теней нет.
  const night = sunForSite(p.site, '2026-06-21', 23 * 60);
  assert.equal(night.up, false);
  assert.deepEqual(shadowPolys(project(createLandscapeObject('tree-oak', 0, 0)), night), []);
});

test('подпись даты и времени', () => {
  assert.equal(formatSunLabel('2026-06-21', 15 * 60 + 30), '21 июня, 15:30');
  assert.equal(formatSunLabel('2026-03-21', 6 * 60), '21 марта, 06:00');
  assert.equal(sunClass(7), 'солнце');
  assert.equal(sunClass(4), 'полутень');
  assert.equal(sunClass(1), 'тень');
});

test('длина тени: столб — высота × ctg, при низком солнце не больше N высот', () => {
  const lamp = createLandscapeObject('lamp', 0, 0, { w: 200, height: 3000 });
  const high = sunAt(180, 45);
  const r1 = reach(shadowPolys(project(lamp), high), high, lamp);
  assert.ok(r1 > 3000 && r1 < 3000 + 200, `45°: ${r1}`);
  const low = sunAt(180, 2);
  assert.equal(low.k, SHADOW_MAX_RATIO);
  const r2 = reach(shadowPolys(project(lamp), low), low, lamp);
  assert.ok(r2 <= 3000 * SHADOW_MAX_RATIO + 200 && r2 > 3000 * SHADOW_MAX_RATIO * 0.95, `низкое солнце: ${r2}`);
});

test('дерево: крона-эллипсоид на высоте + ствол; хвойное — конус до вершины', () => {
  const sun = sunAt(180, 45);
  const oak = createLandscapeObject('tree-oak', 0, 0, { w: 8000, height: 12000 });
  const polys = shadowPolys(project(oak), sun);
  assert.ok(polys.length >= 2, 'крона и ствол');
  assert.ok(polys.every((s) => s.kind === 'tree' && s.id === oak.id && s.z === 12000));
  const r = reach(polys, sun, oak);
  // Вынос: не меньше центра кроны (выше половины высоты) и не больше вершины + радиус.
  assert.ok(r > 12000 * 0.6 && r <= 12000 + 4000 + 1, `дуб: ${r}`);
  // Тень кроны оторвана от ствола: точка у самого дерева в стороне от ствола — светлая.
  const pine = createLandscapeObject('tree-pine', 0, 0, { w: 4000, height: 10000 });
  const pr = reach(shadowPolys(project(pine), sun), sun, pine);
  assert.ok(Math.abs(pr - 10000) < 5, `сосна: вершина конуса ${pr}`);
  // Куст — короткая тень.
  const bush = createLandscapeObject('shrub-box', 0, 0);
  const br = reach(shadowPolys(project(bush), sun), sun, bush);
  assert.ok(br <= bush.height + bush.w / 2 + 1);
});

test('все полигоны одной ориентации (заливка nonzero объединяет их)', () => {
  const p = project(
    createLandscapeObject('tree-oak', 0, 0),
    createLandscapeObject('gazebo', 8000, 0, { rotation: 30 }),
    createLandscapeObject('fence-line', 0, 0, { points: [{ x: -5000, y: 5000 }, { x: 5000, y: 5000 }, { x: 5000, y: 9000 }] }),
    createLandscapeObject('planter-area', 0, 0, { points: [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 4000 }, { x: 2000, y: 1500 }, { x: 0, y: 4000 }] }),
  );
  p.rooms.push(createRoom('living', -12000, -6000, 6000, 5000));
  for (const t of [7 * 60, 12 * 60, 18 * 60]) {
    const polys = shadowPolys(p, sunForSite(p.site, '2026-06-21', t));
    assert.ok(polys.length > 6);
    for (const s of polys) assert.ok(area(s.poly) > 0, `${s.kind} ориентация`);
    for (let i = 1; i < polys.length; i += 1) assert.ok(polys[i].z >= polys[i - 1].z, 'по z');
  }
});

test('подпорная стенка: к низу — на всю высоту, к верху — только парапет', () => {
  // Ось слева направо; верх — по умолчанию (minus — левая по ходу, то есть сверху на плане).
  const wall = createLandscapeObject('retaining-wall', 0, 0, { points: [{ x: -3000, y: 0 }, { x: 3000, y: 0 }], height: 1500 });
  const toDown = sunAt(0, 45); // солнце на севере → тень вниз (y > 0)
  const toUp = sunAt(180, 45); // тень вверх
  const down = shadowPolys(project(wall), toDown);
  const up = shadowPolys(project(wall), toUp);
  const rd = reach(down, toDown, { x: 0, y: 0 });
  const ru = up.length ? reach(up, toUp, { x: 0, y: 0 }) : 0;
  // Одна из сторон — низ: там тень на всю высоту, с другой — нет (парапета нет).
  assert.ok(Math.max(rd, ru) > 1500, 'к низу на всю высоту');
  assert.ok(Math.min(rd, ru) < 400, 'к верху — только толщина');
});

test('растение в коробе стоит на засыпке: тень длиннее', () => {
  const box = createLandscapeObject('planter-box', 0, 0, { w: 3000, h: 1200, height: 600 });
  const bush = createLandscapeObject('shrub-box', 0, 0, { parent: box.id });
  const free = createLandscapeObject('shrub-box', 0, 0);
  const sun = sunAt(180, 45);
  const inBox = reach(shadowPolys(project(box, bush), sun).filter((s) => s.id === bush.id), sun, bush);
  const onGround = reach(shadowPolys(project(free), sun), sun, free);
  assert.ok(Math.abs(inBox - onGround - 600) < 5, `подъём на борт: ${inBox - onGround}`);
  assert.ok(castsShadow(box));
  assert.equal(castsShadow(createLandscapeObject('lawn-patch', 0, 0)), false);
});

test('дом: комнаты всех этажей до верха своего этажа, с наружной стеной', () => {
  const p = createProject();
  p.rooms.push(createRoom('living', 0, 0, 6000, 4000));
  const sun = sunAt(180, 45);
  const polys = shadowPolys(p, sun);
  const house = polys.filter((s) => s.kind === 'house');
  assert.equal(house.length, 1);
  const top = p.levels[0].elevation + p.levels[0].height;
  assert.equal(house[0].z, top);
  // Тень вверх (на север) от наружной грани стены (y = −250) на высоту этажа.
  const minY = Math.min(...house[0].poly.map((q) => q.y));
  assert.ok(Math.abs(minY - (-250 - top)) < 2, `верх тени ${minY}`);
  assert.deepEqual(shadowPolys(p, sun, { house: false }), []);
});

test('подпись проекта меняется при правке и стабильна без неё', () => {
  const oak = createLandscapeObject('tree-oak', 0, 0);
  const p = project(oak);
  const a = shadowSignature(p);
  assert.equal(shadowSignature(p), a);
  oak.x += 100;
  assert.notEqual(shadowSignature(p), a);
  const b = shadowSignature(p);
  oak.height += 500;
  assert.notEqual(shadowSignature(p), b);
});

test('сетка «солнечных часов»: открытое место — весь день, за стеной — меньше; сводка по клумбам', () => {
  const p = createProject();
  p.site.boundary = [{ x: -10000, y: -10000 }, { x: 10000, y: -10000 }, { x: 10000, y: 10000 }, { x: -10000, y: 10000 }];
  const empty = sunHoursGrid(p, '2026-06-21');
  assert.equal(empty.cols, 20);
  assert.ok(empty.dayHours > 13);
  assert.ok(Math.abs(sunHoursAt(empty, { x: 0, y: 0 }) - empty.dayHours) < 1e-6);
  // Высокий забор вдоль y = 0: к северу от него (y < 0) меньше солнца, чем к югу.
  const wall = createLandscapeObject('fence-line', 0, 0, { points: [{ x: -9000, y: 0 }, { x: 9000, y: 0 }], height: 4000 });
  const bed = createLandscapeObject('bed-rect', 0, -1500, { w: 4000, h: 1200 });
  const sunny = createLandscapeObject('bed-rect', 0, 6000, { w: 4000, h: 1200 });
  p.site.landscape.objects.push(wall, bed, sunny);
  const g = sunHoursGrid(p, '2026-12-21'); // зимой солнце низко — тень длинная
  const north = sunHoursAt(g, { x: 0, y: -1500 });
  const south = sunHoursAt(g, { x: 0, y: 6000 });
  assert.ok(north < south - 2, `север ${north} < юг ${south}`);
  const sum = sunHoursSummary(g, p.site.landscape.objects);
  assert.equal(sum.beds.length, 2);
  const b1 = sum.beds.find((b) => b.id === bed.id);
  const b2 = sum.beds.find((b) => b.id === sunny.id);
  assert.ok(b1.hours < b2.hours);
  assert.ok(sum.mean > 0 && sum.mean <= g.dayHours);
  assert.ok(sum.areaM2 > 390 && sum.areaM2 <= 400);
  // Нет границы — нет сетки.
  assert.equal(sunHoursGrid(createProject(), '2026-06-21'), null);
});

test('настройки вида теней: умолчания без localStorage и сохранение в состоянии', () => {
  const s = loadLandscapeSun();
  assert.equal(s.mode, 'default');
  assert.equal(s.time, 15 * 60);
  assert.match(s.date, /^\d{4}-06-21$/);
  setLandscapeSun({ mode: 'sun', time: 7 * 60 });
  assert.equal(state.lsSun.mode, 'sun');
  assert.equal(state.lsSun.time, 420);
});

test('короб не затеняет свою засыпку в анализе освещённости', () => {
  const p = createProject();
  p.site.boundary = [{ x: -6000, y: -6000 }, { x: 6000, y: -6000 }, { x: 6000, y: 6000 }, { x: -6000, y: 6000 }];
  const box = createLandscapeObject('planter-box', 0, 0, { w: 4000, h: 3000, height: 450 });
  p.site.landscape.objects.push(box);
  const g = sunHoursGrid(p, '2026-06-21');
  assert.ok(Math.abs(sunHoursAt(g, { x: 500, y: 500 }) - g.dayHours) < 1e-6);
  const sum = sunHoursSummary(g, p.site.landscape.objects);
  assert.ok(sum.beds[0].hours > g.dayHours * 0.9);
});

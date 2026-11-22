// Поворот вида по режимам (core/view-angles.js): угол по двум точкам,
// независимость режимов, нормализация и сохранение, вариант А.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildingAlignedToView, cleanViewAngles, customViewAngle, isPlanEmpty, lineViewAngle,
  normViewAngle, resetViewAngle, setViewAngle, viewAngle, viewRotation,
} from '../core/view-angles.js';
import { toWorld } from '../core/building.js';
import { createProject, createRoom, deserializeProject, serializeProject } from '../core/model.js';
import { projectPoint } from '../render.js';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

function withRoom() {
  const p = createProject();
  p.rooms.push(createRoom('living', 0, 0, 5000, 4000));
  return p;
}

test('угол по двум точкам: линия на экране горизонтальна, вид не переворачивается', () => {
  const a = { x: 100, y: 200 };
  const b = { x: 100 + 1000, y: 200 + 577.35 };
  const deg = lineViewAngle(a, b, 0);
  assert.ok(near(deg, 30, 0.01), `угол ${deg}`);
  // Те же точки в обратном порядке — тот же вид (ближайший к текущему).
  assert.ok(near(lineViewAngle(b, a, 0), 30, 0.01));
  // Текущий вид развёрнут — выбирается вариант +180°.
  assert.ok(near(lineViewAngle(a, b, 200), -150, 0.01));
  // Проверка камерой: после поворота линия горизонтальна.
  const view = { scale: 0.05, panX: 0, panY: 0, rotation: -(deg * Math.PI) / 180 };
  const sa = projectPoint(view, a.x, a.y);
  const sb = projectPoint(view, b.x, b.y);
  assert.ok(Math.abs(sb.y - sa.y) < 0.01, 'линия горизонтальна');
  assert.ok(sb.x > sa.x);
  assert.equal(lineViewAngle(a, a), null);
});

test('нормализация угла: (−180; 180]', () => {
  assert.equal(normViewAngle(190), -170);
  assert.equal(normViewAngle(-190), 170);
  assert.equal(normViewAngle(180), 180);
  assert.equal(normViewAngle(-0), 0);
  assert.equal(normViewAngle('x'), 0);
});

test('умолчания: «План» по осям дома, «Участок»/«Ландшафт» — север вверх', () => {
  const p = createProject();
  p.building.rotation = 20;
  p.site.north = 15;
  assert.equal(viewAngle(p, 'plan'), 20);
  assert.equal(viewAngle(p, 'site'), 15);
  assert.equal(viewAngle(p, 'landscape'), 15);
  assert.ok(near(viewRotation(p, 'plan'), -(20 * Math.PI) / 180));
  assert.equal(customViewAngle(p, 'plan'), null);
  assert.ok(Object.is(viewRotation(createProject(), 'site'), 0), 'без «-0»');
});

test('углы режимов независимы и имеют приоритет над north/building.rotation', () => {
  const p = withRoom();
  setViewAngle(p, 'plan', 12);
  setViewAngle(p, 'site', -40);
  assert.equal(viewAngle(p, 'plan'), 12);
  assert.equal(viewAngle(p, 'site'), -40);
  assert.equal(viewAngle(p, 'landscape'), 0, 'ландшафт — по умолчанию');
  setViewAngle(p, 'landscape', 5);
  p.site.north = 77;
  p.building.rotation = 33;
  assert.deepEqual(p.settings.viewAngles, { plan: 12, site: -40, landscape: 5 });
  assert.equal(viewAngle(p, 'site'), -40);
  assert.equal(viewAngle(p, 'plan'), 12);
  resetViewAngle(p, 'site');
  assert.equal(viewAngle(p, 'site'), 77, 'сброс — снова север');
  assert.equal(viewAngle(p, 'plan'), 12, 'сброс одного режима не трогает другие');
  resetViewAngle(p, 'plan');
  resetViewAngle(p, 'landscape');
  assert.equal('viewAngles' in p.settings, false);
});

test('сохранение и загрузка: углы вида переживают файл, мусор отбрасывается', () => {
  const p = withRoom();
  setViewAngle(p, 'plan', 12.5);
  setViewAngle(p, 'site', 200);
  const back = deserializeProject(serializeProject(p));
  assert.deepEqual(back.settings.viewAngles, { plan: 12.5, site: -160 });
  assert.equal(viewAngle(back, 'plan'), 12.5);
  assert.deepEqual(cleanViewAngles({ plan: '7', site: 'abc', landscape: Infinity, other: 3 }), { plan: 7 });
  assert.equal(cleanViewAngles([1, 2]), null);
  // Старый проект без поля — без поля и после загрузки, поворот дома сохранён.
  const old = withRoom();
  old.building.rotation = 30;
  const loaded = deserializeProject(serializeProject(old));
  assert.equal('viewAngles' in loaded.settings, false);
  assert.equal(viewAngle(loaded, 'plan'), 30, 'выровненный ранее дом — «План» по его осям');
  const broken = JSON.parse(serializeProject(old));
  broken.settings.viewAngles = 'мусор';
  assert.equal('viewAngles' in deserializeProject(JSON.stringify(broken)).settings, false);
});

test('вариант А: пустой «План» — оси дома по виду; нарисованный дом не трогается', () => {
  const empty = createProject();
  assert.ok(isPlanEmpty(empty));
  const res = setViewAngle(empty, 'plan', 25, { pivot: { x: 1000, y: 2000 } });
  assert.equal(res.axesChanged, true);
  assert.equal(empty.building.rotation, 25);
  // Опорная точка дома осталась на месте мира.
  const pw = toWorld(empty.building, { x: 1000, y: 2000 });
  assert.ok(near(pw.x, 1000) && near(pw.y, 2000));

  // «Участок» в пустом проекте оси не меняет.
  const empty2 = createProject();
  assert.equal(setViewAngle(empty2, 'site', 25).axesChanged, false);
  assert.equal(empty2.building.rotation, 0);

  const full = withRoom();
  const before = JSON.stringify({ b: full.building, r: full.rooms });
  const res2 = setViewAngle(full, 'plan', 25);
  assert.equal(res2.axesChanged, false);
  assert.equal(JSON.stringify({ b: full.building, r: full.rooms }), before, 'данные дома не изменились');
  assert.equal(viewAngle(full, 'plan'), 25);
});

test('«Развернуть оси дома по виду»: ближайший поворот, на месте вокруг опоры', () => {
  const p = withRoom();
  assert.equal(buildingAlignedToView(p, 'plan', { x: 0, y: 0 }), null, 'без своего угла уже по осям');
  setViewAngle(p, 'plan', 100);
  const nb = buildingAlignedToView(p, 'plan', { x: 2500, y: 2000 });
  assert.equal(nb.rotation, 10, '100° ≡ 10° по осям — ближайший к 0°');
  const pw = toWorld(nb, { x: 2500, y: 2000 });
  assert.ok(near(pw.x, 2500) && near(pw.y, 2000));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { toWorld } from '../core/building.js';
import { createLandscapeObject } from '../core/landscape.js';
import { createItem, createOpening, createProject, createRoom } from '../core/model.js';
import { createRoof } from '../core/roofs.js';
import { roomContainsPoint } from '../core/room-shape.js';
import { sunPosition } from '../core/site.js';
import { solarObstaclesOf, sunRayBlocked, windowsOf } from '../core/insolation.js';
import { sharedKey } from '../core/walls.js';
import {
  roomSunGrid, roomSunlightAnalysis, roomSunlightAnalysisKey, SOLAR_OCCLUDER_ASSUMPTIONS,
} from '../core/solar-analysis.js';

function sunRoom({ width = 1200, height = 1500, sill = 800 } = {}) {
  const project = createProject('Солнечная комната');
  project.site.solarVerified = true;
  project.site.sun.date = '2026-03-21';
  const room = createRoom('living', 0, 0, 6000, 5000);
  const opening = createOpening('window', room.id, 2, 3000, width); // южный фасад
  opening.height = height;
  opening.sill = sill;
  project.rooms.push(room);
  project.openings.push(opening);
  return { project, room, opening };
}

const analyze = (project, room, extra = {}) => roomSunlightAnalysis(project, {
  roomId: room.id,
  date: '2026-03-21',
  from: 6 * 60,
  to: 18 * 60,
  stepMin: 10,
  cell: 500,
  ...extra,
});

test('карта детерминирована, чиста и содержит профессиональные метрики', () => {
  const { project, room } = sunRoom();
  const before = JSON.stringify(project);
  const a = analyze(project, room);
  const b = analyze(project, room);
  assert.equal(JSON.stringify(project), before, 'анализ не меняет проект');
  assert.deepEqual(a, b);
  assert.equal(a.verified, true);
  assert.equal(a.estimated, false);
  assert.equal(a.windows, 1);
  assert.equal(a.points.length, 120);
  assert.ok(a.meanMinutes > 0);
  assert.ok(a.maxMinutes >= a.meanMinutes);
  assert.ok(a.litShare > 0 && a.litShare <= 1);
  assert.ok(a.coverage2h >= 0 && a.coverage2h <= a.litShare);
  assert.ok(a.litAreaM2 > 0);
  assert.equal(a.glazing.area, 1.8);
  assert.equal(a.glazing.floorArea, 30);
  assert.equal(a.glazing.meets, false);
  assert.equal(a.key, roomSunlightAnalysisKey(project, {
    roomId: room.id, date: '2026-03-21', from: 360, to: 1080, stepMin: 10, cell: 500,
  }));
});

test('ширина и высота окна увеличивают солнечную экспозицию комнаты', () => {
  const { project, room, opening } = sunRoom({ width: 600, height: 1000 });
  const narrow = analyze(project, room);
  opening.width = 3000;
  const wide = analyze(project, room);
  assert.ok(wide.meanMinutes > narrow.meanMinutes, `${narrow.meanMinutes} → ${wide.meanMinutes}`);
  assert.ok(wide.solarExposureM2h > narrow.solarExposureM2h);

  opening.width = 600;
  opening.height = 2200;
  const tall = analyze(project, room);
  assert.ok(tall.meanMinutes > narrow.meanMinutes, `${narrow.meanMinutes} → ${tall.meanMinutes}`);
  assert.ok(tall.litShare > narrow.litShare);
});

test('без окон карта нулевая, а площадь остекления не проходит 1:8', () => {
  const project = createProject();
  project.site.solarVerified = false;
  const room = createRoom('living', 0, 0, 4000, 4000);
  project.rooms.push(room);
  const result = analyze(project, room, { workplane: 0 });
  assert.equal(result.verified, false);
  assert.equal(result.estimated, true);
  assert.equal(result.windows, 0);
  assert.equal(result.workplane, 0);
  assert.ok(result.points.every((point) => point.minutes === 0));
  assert.deepEqual(
    { area: result.glazing.area, ratio: result.glazing.ratio, meets: result.glazing.meets },
    { area: 0, ratio: 0, meets: false },
  );
});

test('высокий сосед уменьшает прямое солнце', () => {
  const { project, room, opening } = sunRoom({ width: 3000, height: 2800, sill: 0 });
  const free = analyze(project, room);
  project.site.neighbors.push({
    id: 'shade', x: 3000, y: room.y + room.h + 3250,
    w: 20000, h: 4000, height: 15000, rot: 0,
  });
  const shaded = analyze(project, room);
  assert.ok(free.meanMinutes > 0);
  assert.ok(shaded.meanMinutes < free.meanMinutes);
  assert.ok(shaded.solarExposureM2h < free.solarExposureM2h);
  assert.equal(opening.width, 3000);
});

test('поворот здания переводит южное окно на север и меняет карту', () => {
  const { project, room } = sunRoom({ width: 3000, height: 2800, sill: 0 });
  const south = analyze(project, room);
  project.building = { rotation: 180, origin: { x: 0, y: 0 } };
  const north = analyze(project, room);
  assert.ok(south.meanMinutes > 0);
  assert.equal(north.meanMinutes, 0);
  assert.equal(north.litShare, 0);
});

test('Г-образный вырез не получает ячейки, большая комната соблюдает лимит', () => {
  const room = createRoom('living', 0, 0, 6000, 5000);
  room.notch = { corner: 'ne', w: 2000, h: 2000 };
  const grid = roomSunGrid(room, { cell: 500, maxCells: 400 });
  assert.ok(grid.points.length > 0);
  assert.ok(grid.points.every((point) => roomContainsPoint(room, point.x, point.y)));
  assert.ok(grid.points.every((point) => !(point.x > 4000 && point.y < 2000)));
  assert.equal(grid.points.reduce((sum, point) => sum + point.area, 0), 26_000_000);

  const huge = createRoom('living', 0, 0, 100000, 100000);
  const capped = roomSunGrid(huge, { cell: 100, maxCells: 64 });
  assert.ok(capped.points.length <= 64, `${capped.points.length} ячеек`);
  assert.ok(capped.cell > 100);
});

test('ключ реагирует на окно/солнце/препятствие, но не на мебель и имя', () => {
  const { project, room, opening } = sunRoom();
  const options = { roomId: room.id, cell: 500 };
  const initial = roomSunlightAnalysisKey(project, options);
  project.name = 'Другое имя';
  project.items.push(createItem('chair', 1000, 1000, 450, 450));
  assert.equal(roomSunlightAnalysisKey(project, options), initial);
  opening.width += 100;
  assert.notEqual(roomSunlightAnalysisKey(project, options), initial);
  opening.width -= 100;
  project.site.neighbors.push({ id: 'n', x: 0, y: 10000, w: 5000, h: 5000, height: 6000 });
  assert.notEqual(roomSunlightAnalysisKey(project, options), initial);
});

test('ключ карты учитывает массы, крыши и ландшафт', () => {
  const { project, room } = sunRoom();
  const options = { roomId: room.id, cell: 500 };
  const initial = roomSunlightAnalysisKey(project, options);

  project.masses = [{ id: 'M', x: 8000, y: 8000, w: 2000, d: 3000, z0: 0, h: 4000, rotation: 0 }];
  assert.notEqual(roomSunlightAnalysisKey(project, options), initial);
  delete project.masses;

  project.roofs = [createRoof({
    levelId: project.activeLevel,
    outline: [{ x: 0, y: 0 }, { x: 3000, y: 0 }, { x: 3000, y: 3000 }, { x: 0, y: 3000 }],
  })];
  assert.notEqual(roomSunlightAnalysisKey(project, options), initial);
  delete project.roofs;

  project.site.landscape = { objects: [createLandscapeObject('tree-oak', 3000, 9000, { id: 'T' })] };
  assert.notEqual(roomSunlightAnalysisKey(project, options), initial);
});

test('солнечные объёмы: massVoid не блокирует, поворот дома учтён, дерево разделено на крону и ствол', () => {
  const project = createProject();
  project.building = { rotation: 90, origin: { x: 10000, y: 20000 } };
  project.masses = [{ id: 'solid', x: 1000, y: 2000, w: 2000, d: 4000, z0: 500, h: 3500, rotation: 0 }];
  project.massVoids = [{ id: 'void-cut', x: 1000, y: 2000, w: 1000, d: 1000, z0: 0, h: 5000, rotation: 0 }];
  project.site.landscape = { objects: [
    createLandscapeObject('tree-oak', 20000, 20000, { id: 'tree', w: 9000, height: 16000 }),
    createLandscapeObject('pad', 30000, 30000, { id: 'flat-pad' }),
  ] };
  const before = JSON.stringify(project);
  const obstacles = solarObstaclesOf(project);
  assert.equal(JSON.stringify(project), before, 'построение объёмов не меняет проект');
  assert.equal(obstacles.some((entry) => entry.massId === 'void-cut'), false);
  assert.equal(obstacles.some((entry) => entry.landscapeId === 'flat-pad'), false);
  assert.ok(obstacles.some((entry) => entry.landscapeId === 'tree' && entry.kind === 'tree-crown'));
  assert.ok(obstacles.some((entry) => entry.landscapeId === 'tree' && entry.kind === 'tree-trunk'));

  const mass = obstacles.find((entry) => entry.massId === 'solid');
  assert.equal(mass.approximation, 'solid-box-minus-voids');
  assert.deepEqual(mass.massCutouts.map((entry) => entry.massVoidId), ['void-cut']);
  assert.deepEqual(
    {
      minX: Math.min(...mass.poly.map((point) => point.x)), maxX: Math.max(...mass.poly.map((point) => point.x)),
      minY: Math.min(...mass.poly.map((point) => point.y)), maxY: Math.max(...mass.poly.map((point) => point.y)),
      bottom: mass.bottom, top: mass.top,
    },
    { minX: 6000, maxX: 10000, minY: 20000, maxY: 22000, bottom: 500, top: 4000 },
  );
});

test('massVoid вычитает только полностью покрытый 3D-отрезок луча внутри массы', () => {
  const project = createProject();
  project.masses = [{ id: 'solid', x: 0, y: 0, w: 4000, d: 4000, z0: 0, h: 3000, rotation: 0 }];
  const ray = { dir: { x: 0, y: 1 }, tanAlt: 0 };
  const blocked = (x = 0, z = 1500) => sunRayBlocked(
    { x, y: -5000 }, z, ray, solarObstaclesOf(project).filter((entry) => entry.kind === 'mass'),
  );

  assert.equal(blocked(), true, 'сплошная масса блокирует');
  project.massVoids = [{ id: 'through', x: 0, y: 0, w: 1000, d: 4000, z0: 0, h: 3000, rotation: 0 }];
  assert.equal(blocked(), false, 'сквозной cutter освобождает луч');
  assert.equal(blocked(1500), true, 'параллельный луч рядом с отверстием остаётся заблокирован');

  project.massVoids = [{ id: 'niche', x: 0, y: 0, w: 1000, d: 2000, z0: 0, h: 3000, rotation: 0 }];
  assert.equal(blocked(), true, 'ниша лишь в середине XY не удаляет массу до и после себя');

  project.massVoids = [{ id: 'vertical', x: 0, y: 0, w: 1000, d: 4000, z0: 1000, h: 1000, rotation: 0 }];
  assert.equal(blocked(0, 1500), false, 'луч внутри высотного диапазона отверстия проходит');
  assert.equal(blocked(0, 500), true, 'ниже отверстия масса остаётся');
  assert.equal(blocked(0, 2500), true, 'выше отверстия масса остаётся');

  const risingRay = { dir: { x: 0, y: 1 }, tanAlt: 0.5 };
  const risingBlocked = () => sunRayBlocked(
    { x: 0, y: -5000 }, 500, risingRay,
    solarObstaclesOf(project).filter((entry) => entry.kind === 'mass'),
  );
  project.massVoids = [{ id: 'rising-through', x: 0, y: 0, w: 1000, d: 4000, z0: 1900, h: 1200, rotation: 0 }];
  assert.equal(risingBlocked(), false, 'cutter покрывает полный наклонный 3D-интервал луча в массе');
  project.massVoids[0].h = 600;
  assert.equal(risingBlocked(), true, 'луч, вышедший из cutter по Z, снова встречает сплошную массу');

  project.massVoids = [{ id: 'above', x: 0, y: 0, w: 1000, d: 4000, z0: 4000, h: 1000, rotation: 0 }];
  let mass = solarObstaclesOf(project).find((entry) => entry.kind === 'mass');
  assert.equal(mass.massCutouts.length, 0, 'cutter вне диапазона Z к массе не прикрепляется');
  project.massVoids = [{ id: 'outside', x: 10000, y: 0, w: 1000, d: 4000, z0: 0, h: 3000, rotation: 0 }];
  mass = solarObstaclesOf(project).find((entry) => entry.kind === 'mass');
  assert.equal(mass.massCutouts.length, 0, 'непересекающий XY cutter к массе не прикрепляется');
  project.massVoids = [{ id: 'touching', x: 2500, y: 0, w: 1000, d: 4000, z0: 0, h: 3000, rotation: 0 }];
  mass = solarObstaclesOf(project).find((entry) => entry.kind === 'mass');
  assert.equal(mass.massCutouts.length, 0, 'простое касание грани не считается вычитанием объёма');
  assert.equal(blocked(), true);
});

test('несколько massVoid объединяют интервалы, реальный зазор между ними блокирует', () => {
  const project = createProject();
  project.masses = [{ id: 'solid', x: 0, y: 0, w: 4000, d: 4000, z0: 0, h: 3000, rotation: 0 }];
  project.massVoids = [
    { id: 'north-half', x: 0, y: -1000, w: 1000, d: 2000, z0: 0, h: 3000, rotation: 0 },
    { id: 'south-half', x: 0, y: 1000, w: 1000, d: 2000, z0: 0, h: 3000, rotation: 0 },
  ];
  const ray = { dir: { x: 0, y: 1 }, tanAlt: 0 };
  const blocked = () => sunRayBlocked(
    { x: 0, y: -5000 }, 1500, ray, solarObstaclesOf(project).filter((entry) => entry.kind === 'mass'),
  );
  assert.equal(blocked(), false, 'касающиеся cutter-ы совместно образуют сквозной тоннель');
  project.massVoids[1].y += 2;
  assert.equal(blocked(), true, '2 мм сплошной массы между cutter-ами блокируют луч');
});

test('massVoid учитывает поворот здания и кратный 90° поворот массы', () => {
  const project = createProject();
  project.building = { rotation: 90, origin: { x: 10000, y: 20000 } };
  project.masses = [{ id: 'solid', x: 1000, y: 2000, w: 4000, d: 2000, z0: 500, h: 3000, rotation: 90 }];
  project.massVoids = [{ id: 'through', x: 1000, y: 2000, w: 4000, d: 500, z0: 500, h: 3000, rotation: 90 }];
  const obstacles = solarObstaclesOf(project).filter((entry) => entry.kind === 'mass');
  const ray = { dir: { x: -1, y: 0 }, tanAlt: 0 }; // локальная +Y после поворота здания на 90°
  assert.equal(sunRayBlocked(toWorld(project.building, { x: 1000, y: -2000 }), 1500, ray, obstacles), false);
  assert.equal(sunRayBlocked(toWorld(project.building, { x: 1800, y: -2000 }), 1500, ray, obstacles), true);
});

test('Г-крыша сохраняет вырез, а вынос плиты затеняет', () => {
  const project = createProject();
  const roof = createRoof({
    levelId: project.activeLevel,
    outline: [
      { x: 0, y: 0 }, { x: 6000, y: 0 }, { x: 6000, y: 2000 },
      { x: 2000, y: 2000 }, { x: 2000, y: 6000 }, { x: 0, y: 6000 },
    ],
    overhang: { n: 0, e: 1000, s: 0, w: 0 },
    thickness: 300,
  });
  project.roofs = [roof];
  const roofs = solarObstaclesOf(project).filter((entry) => entry.kind === 'roof');
  const z = project.levels[0].elevation + project.levels[0].height + 100;
  const flatRay = { dir: { x: 1, y: 0 }, tanAlt: 0 };

  assert.equal(sunRayBlocked({ x: 4000, y: 3000 }, z, flatRay, roofs), false, 'вырез Г-формы свободен');
  assert.equal(sunRayBlocked({ x: 3000, y: 1000 }, z, flatRay, roofs), true, 'под плитой луч блокируется');
  assert.ok(roofs.some((entry) => Math.max(...entry.poly.map((point) => point.x)) === 7000), 'учтён вынос 1000 мм');
});

test('треугольная крыша не затеняет пустой угол своего bbox', () => {
  const project = createProject();
  project.building = { rotation: 90, origin: { x: 20000, y: 30000 } };
  project.roofs = [createRoof({
    levelId: project.activeLevel,
    outline: [{ x: 0, y: 0 }, { x: 10000, y: 0 }, { x: 0, y: 10000 }],
    overhang: { n: 0, e: 0, s: 0, w: 0 }, thickness: 300,
  })];
  const roofs = solarObstaclesOf(project).filter((entry) => entry.kind === 'roof');
  const z = project.levels[0].elevation + project.levels[0].height + 100;
  const ray = { dir: { x: 0, y: 1 }, tanAlt: 0 }; // локальная +X после поворота дома на 90°
  assert.equal(sunRayBlocked(toWorld(project.building, { x: 9000, y: 9000 }), z, ray, roofs), false);
  assert.equal(sunRayBlocked(toWorld(project.building, { x: 1000, y: 1000 }), z, ray, roofs), true);
  assert.ok(roofs.every((entry) => entry.approximation === 'triangulated-slab'));
});

test('ландшафт блокирует только луч впереди и на высоте своего объёма', () => {
  const project = createProject();
  const ray = { dir: { x: 0, y: 1 }, tanAlt: 0.1 };
  const blocked = (objects, origin = { x: 0, y: 0 }, z = 100, sun = ray) => {
    project.site.landscape = { objects };
    const landscape = solarObstaclesOf(project).filter((entry) => entry.landscapeId);
    return sunRayBlocked(origin, z, sun, landscape);
  };

  assert.equal(blocked([]), false, 'базовый луч свободен');
  assert.equal(blocked([createLandscapeObject('fence', 0, 1000, { id: 'ahead', w: 2000 })]), true);
  assert.equal(blocked([createLandscapeObject('fence', 5000, 1000, { id: 'side', w: 2000 })]), false);
  assert.equal(blocked([createLandscapeObject('fence', 0, -1000, { id: 'behind', w: 2000 })]), false);
  assert.equal(blocked([createLandscapeObject('pad', 0, 1000, { id: 'no-shadow' })]), false);

  const carport = createLandscapeObject('carport', 0, 6000, { id: 'canopy' });
  assert.equal(blocked([carport]), false, 'короткий низкий луч проходит под навесом');
  assert.equal(blocked([carport], { x: 0, y: 0 }, 2580, { dir: { x: 0, y: 1 }, tanAlt: 0.01 }), true,
    'луч на высоте кровли блокируется');
});

test('масса, крыша, крона и навес между окном и небом уменьшают прямое солнце', async (t) => {
  const cases = {
    'сплошная масса': (project) => {
      project.masses = [{ id: 'shade-mass', x: 3000, y: 7000, w: 20000, d: 3000, z0: 0, h: 20000, rotation: 0 }];
    },
    'плита крыши': (project) => {
      project.roofs = [createRoof({
        levelId: project.activeLevel,
        outline: [{ x: -10000, y: 5250 }, { x: 16000, y: 5250 }, { x: 16000, y: 16000 }, { x: -10000, y: 16000 }],
        overhang: { n: 0, e: 0, s: 0, w: 0 }, thickness: 600,
      })];
    },
    'крона дерева': (project) => {
      project.site.landscape = { objects: [
        createLandscapeObject('tree-pine', 3000, 8000, { id: 'shade-tree', w: 20000, h: 10000, height: 15000 }),
      ] };
    },
    'кровля навеса': (project) => {
      project.site.landscape = { objects: [
        createLandscapeObject('carport', 3000, 8500, { id: 'shade-canopy', w: 20000, h: 6000, height: 2600 }),
      ] };
    },
  };
  for (const [title, add] of Object.entries(cases)) {
    await t.test(title, () => {
      const { project, room } = sunRoom({ width: 3000, height: 2800, sill: 0 });
      const free = analyze(project, room);
      add(project);
      const shaded = analyze(project, room);
      assert.ok(free.meanMinutes > 0);
      assert.ok(shaded.meanMinutes < free.meanMinutes, `${free.meanMinutes} → ${shaded.meanMinutes}`);
      assert.ok(shaded.solarExposureM2h < free.solarExposureM2h);
    });
  }
});

test('massVoid и плоское покрытие между окном и небом не создают тень', () => {
  const { project, room } = sunRoom({ width: 3000, height: 2800, sill: 0 });
  const free = analyze(project, room);
  project.massVoids = [{ id: 'void-only', x: 3000, y: 7000, w: 20000, d: 3000, z0: 0, h: 20000, rotation: 0 }];
  assert.equal(analyze(project, room).meanMinutes, free.meanMinutes);

  delete project.massVoids;
  project.site.landscape = { objects: [createLandscapeObject('pad', 3000, 7000, { id: 'ground-only', w: 20000, h: 3000 })] };
  assert.equal(analyze(project, room).meanMinutes, free.meanMinutes);
});

test('сквозной massVoid восстанавливает свет, отнятый совпадающей сплошной массой', () => {
  const { project, room } = sunRoom({ width: 3000, height: 2800, sill: 0 });
  const free = analyze(project, room);
  const solid = { id: 'shade', x: 3000, y: 7000, w: 20000, d: 3000, z0: 0, h: 20000, rotation: 0 };
  project.masses = [solid];
  const shaded = analyze(project, room);
  assert.ok(shaded.meanMinutes < free.meanMinutes);

  project.massVoids = [{ ...solid, id: 'cut-through' }];
  const cut = analyze(project, room);
  assert.equal(cut.meanMinutes, free.meanMinutes);
  assert.equal(cut.solarExposureM2h, free.solarExposureM2h);
});

test('solarContext повторно использует окна/препятствия и не меняет key', () => {
  const { project, room } = sunRoom({ width: 3000, height: 2800, sill: 0 });
  project.masses = [{ id: 'shade', x: 3000, y: 7000, w: 20000, d: 3000, z0: 0, h: 20000, rotation: 0 }];
  const direct = analyze(project, room);
  const solarContext = { windows: windowsOf(project), obstacles: solarObstaclesOf(project) };
  const prepared = analyze(project, room, { solarContext });
  assert.deepEqual(prepared, direct);
  assert.equal(
    roomSunlightAnalysisKey(project, { roomId: room.id, solarContext }),
    roomSunlightAnalysisKey(project, { roomId: room.id }),
  );
  assert.deepEqual(prepared.assumptions, [...SOLAR_OCCLUDER_ASSUMPTIONS]);
  assert.ok(prepared.assumptions.some((text) => /вычитающая масса вырезает отверстие/.test(text)));
  assert.ok(prepared.occluders.kinds.mass > 0);
});

test('окно на внутренней грани Г-выреза не затеняется bbox своей комнаты', () => {
  const project = createProject();
  project.site.solarVerified = true;
  project.building = { rotation: 180, origin: { x: 0, y: 0 } };
  const room = createRoom('living', 0, 0, 6000, 5000);
  room.notch = { corner: 'ne', w: 2000, h: 2000 };
  const opening = createOpening('window', room.id, 'notch-h', 5000, 1200);
  opening.height = 2000;
  opening.sill = 300;
  project.rooms.push(room);
  project.openings.push(opening);
  const result = analyze(project, room);
  assert.equal(result.windows, 1);
  assert.ok(result.meanMinutes > 0, `mean=${result.meanMinutes}`);
  assert.ok(result.litShare > 0);
});

test('тонкая override-стена не получает самозатенение от fallback наружной толщины', () => {
  const { project, room } = sunRoom({ width: 2400, height: 2000, sill: 300 });
  project.settings.exterior = 250;
  project.wallOverrides[`e|${room.id}|2`] = { thickness: 100 };
  const result = analyze(project, room);
  assert.ok(result.meanMinutes > 0, `mean=${result.meanMinutes}`);
});

test('косой луч facing≈0,5 проходит по длинному пути сквозь наружную стену', () => {
  const { project, room, opening } = sunRoom({ width: 5800, height: 2900, sill: 0 });
  const minute = 8 * 60;
  const position = sunPosition(
    project.site.location.lat, project.site.location.lon, project.site.location.tz, '2026-03-21', minute + 5,
  );
  // angle=120° даёт localDir=(sin120, -cos120), т. е. facing=0,5
  // для южного окна с normal=(0,1).
  project.site.north = 120 - position.azimuth;
  opening.offset = 3000;
  const result = analyze(project, room, { from: minute, to: minute + 10, stepMin: 10, workplane: 0, cell: 250 });
  assert.ok(position.altitude > 0);
  assert.ok(result.maxMinutes > 0, `alt=${position.altitude}, max=${result.maxMinutes}`);
});

test('узкое окно проверяет косой луч на внутренней и наружной грани откоса', () => {
  const { project, room, opening } = sunRoom({ width: 500, height: 2900, sill: 0 });
  const minute = 8 * 60;
  const position = sunPosition(
    project.site.location.lat, project.site.location.lon, project.site.location.tz, '2026-03-21', minute + 5,
  );
  project.site.north = 120 - position.azimuth; // facing южного окна ≈ 0,5
  opening.offset = 3000;
  const result = analyze(project, room, { from: minute, to: minute + 10, stepMin: 10, workplane: 0, cell: 250 });
  const aperture = windowsOf(project).find((candidate) => candidate.openingId === opening.id);
  const angle = ((project.site.north + position.azimuth) * Math.PI) / 180;
  const dir = { x: Math.sin(angle), y: -Math.cos(angle) };
  const facing = dir.x * aperture.normalLocal.x + dir.y * aperture.normalLocal.y;
  const innerPlane = {
    x: aperture.planeLocal.x - aperture.normalLocal.x * aperture.wallThickness,
    y: aperture.planeLocal.y - aperture.normalLocal.y * aperture.wallThickness,
  };
  const lit = result.points.filter((point) => point.minutes > 0);
  assert.ok(lit.length > 0);
  for (const point of lit) {
    const distance = ((innerPlane.x - point.x) * aperture.normalLocal.x +
      (innerPlane.y - point.y) * aperture.normalLocal.y) / facing;
    const hit = { x: point.x + dir.x * distance, y: point.y + dir.y * distance };
    const along = (hit.x - innerPlane.x) * aperture.tangentLocal.x +
      (hit.y - innerPlane.y) * aperture.tangentLocal.y;
    assert.ok(Math.abs(along) <= aperture.width / 2 + 0.5, `луч попал в откос: ${along}`);
  }
});

test('сетка и знаменатель 1:8 используют одну чистую геометрию пола', () => {
  const project = createProject();
  const room = createRoom('living', 0, 0, 6000, 5000);
  const child = createRoom('bathroom', 1000, 1000, 1000, 1000);
  child.parentId = room.id;
  project.rooms.push(room, child);
  project.levels[0].slabOpenings = [{ id: 'slab', x: 3000, y: 1000, w: 1000, h: 1000 }];
  project.massVoids = [{ id: 'void-test', x: 5000, y: 1500, w: 1000, d: 1000, z0: 0, h: 3000, rotation: 0 }];
  const result = analyze(project, room, { cell: 700 });
  const sampled = result.points.reduce((sum, point) => sum + point.area, 0);
  assert.ok(Math.abs(sampled - result.glazing.floorArea * 1_000_000) < 0.01);
  assert.ok(result.points.every((point) => point.rects?.length &&
    Math.abs(point.rects.reduce((sum, rect) => sum + rect.w * rect.h, 0) - point.area) < 0.01));

  const key = result.key;
  project.levels[0].slabOpenings[0].w += 100;
  assert.notEqual(roomSunlightAnalysisKey(project, { roomId: room.id, date: '2026-03-21', from: 360, to: 1080, stepMin: 10, cell: 700 }), key);
});

test('скрытая общая стена объединяет окна и площадь остекления открытой зоны', () => {
  const project = createProject();
  project.site.solarVerified = true;
  const living = createRoom('living', 0, 0, 3000, 4000);
  const kitchen = createRoom('kitchen', 3100, 0, 3000, 4000);
  project.rooms.push(living, kitchen);
  project.wallOverrides[sharedKey(living.id, kitchen.id)] = { hidden: true };
  const opening = createOpening('window', kitchen.id, 1, 2000, 2400);
  opening.height = 2000;
  opening.sill = 300;
  project.openings.push(opening);
  const result = analyze(project, living);
  assert.deepEqual(new Set(result.zoneRoomIds), new Set([living.id, kitchen.id]));
  assert.equal(result.windows, 1);
  assert.equal(result.glazing.floorArea, 24);
  assert.equal(result.glazing.area, 4.8);
  assert.ok(result.meanMinutes > 0, `mean=${result.meanMinutes}`);
});

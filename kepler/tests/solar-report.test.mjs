import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createLevel, createOpening, createProject, createRoom,
} from '../core/model.js';
import {
  SOLAR_REPORT_SCHEMA, buildSolarReport, buildSolarReportAsync, buildSolarReportCsv, buildSolarReportJson,
} from '../core/solar-report.js';
import { sharedKey } from '../core/walls.js';

function reportProject() {
  const project = createProject('Дом; «Солнце»');
  project.site.solarVerified = true;
  project.site.sun.date = '2026-06-21';
  const room = createRoom('living', 0, 0, 6000, 5000);
  room.name = 'Гостиная; "юг"';
  const opening = createOpening('window', room.id, 2, 3000, 3000);
  opening.height = 2000;
  opening.sill = 300;
  project.rooms.push(room);
  project.openings.push(opening);
  return { project, room, opening };
}

const fast = { months: [3, 6], stepMin: 60, cell: 1000, maxCells: 40 };

function assertFiniteNumbers(value, path = 'report') {
  if (typeof value === 'number') {
    assert.ok(Number.isFinite(value), `${path} должен быть конечным числом`);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value)) assertFiniteNumbers(nested, `${path}.${key}`);
}

test('сводка детерминирована, не меняет проект и содержит реперные даты', () => {
  const { project, room } = reportProject();
  const before = JSON.stringify(project);
  const activeLevel = project.activeLevel;
  const a = buildSolarReport(project, fast);
  const b = buildSolarReport(project, fast);
  assert.equal(JSON.stringify(project), before);
  assert.equal(project.activeLevel, activeLevel);
  assert.deepEqual(a, b);
  assert.equal(a.schema, SOLAR_REPORT_SCHEMA);
  assert.equal(a.version, 1);
  assert.equal(a.year, 2026);
  assert.deepEqual(a.representativeDates.map((item) => item.date), ['2026-03-21', '2026-06-21']);
  assert.equal(a.rooms.length, 1);
  assert.equal(a.rooms[0].roomId, room.id);
  assert.equal(a.rooms[0].months.length, 2);
  assert.equal(a.rooms[0].quality, 'verified');
  assert.deepEqual(a.rooms[0].status, { directSunData: 'verified', glazing: 'meets-guideline' });
  assert.equal(a.rooms[0].glazing.area, 6);
  assert.equal(a.rooms[0].glazing.floorArea, 30);
  assert.equal(a.rooms[0].glazing.meets, true);
  assert.deepEqual(a.rooms[0].zoneRoomIds, [room.id]);
  assert.equal(a.rooms[0].glazingScope, 'room');
  assert.ok(a.rooms[0].annual.bestMonth);
  assert.ok(a.rooms[0].annual.worstMonth);
  assert.equal(a.progress.done, 2);
  assert.equal(a.progress.total, 2);
  assert.equal(a.cancelled, false);
  assertFiniteNumbers(a);
});

test('метаданные фиксируют модель, место, единицы и фактическую дискретизацию', () => {
  const { project } = reportProject();
  project.site.north = 27;
  const generatedAt = '2026-11-16T10:20:30.000Z';
  const report = buildSolarReport(project, {
    ...fast, generatedAt, from: 360, to: 1080, workplane: 850,
    daylightAnalyzer: () => ({
      meanDaylightFactor: 2.1, meanLux: 410, coverage300: 0.8,
      method: 'cie-overcast-concept/1', preliminary: true, normative: false,
      confidence: { level: 'medium', score: 0.65, reasons: ['Геометрия задана'] },
      assumptions: {
        sky: 'CIE overcast', externalLux: 10_000, workplane: 850,
        transmission: {
          defaultGlass: 0.7, frameFactor: 0.8, maintenanceFactor: 0.9,
          windows: [{ openingId: 'window-test', glass: 0.72, effective: 0.5184 }],
        },
        interiorReflectance: 0.5, samplesPerWindow: 16,
        reflections: 'Усреднённые', shading: 'Непрозрачные объёмы', skyVisibility: 'Только через окна',
      },
      thresholds: { daylightFactor: 2, lux: 300 },
    }),
  });

  assert.equal(report.generatedAt, generatedAt);
  assert.deepEqual(report.model, {
    id: 'monthly-representative-direct-sun',
    version: 1,
    method: 'ray-traced-direct-sun-on-room-workplane',
  });
  assert.deepEqual(report.site, { lat: 43.238, lon: 76.889, tz: 5, north: 27, verified: true });
  assert.deepEqual(report.units, {
    length: 'mm', area: 'm²', time: 'min', exposure: 'm²·h', ratio: 'fraction',
    percentage: '%', daylightFactor: '%', illuminance: 'lux',
  });
  assert.deepEqual(report.assumptions.directSun, {
    from: 360, to: 1080, stepMin: 60, requestedGridCell: 1000, maxCells: 40, requestedWorkplane: 850,
    occluders: {
      treatment: 'opaque-year-round',
      roofsAndMasses: 'opaque',
      massVoids: 'subtract-overlap-from-solid-mass-shadow-and-never-cast-alone',
      treeCrowns: 'opaque-without-seasonality',
      translucentStructures: 'conservatively-opaque',
      terrain: 'flat-without-terrain-shadowing',
    },
  });
  assert.equal(report.assumptions.daylight.enabled, true);
  assert.equal(report.assumptions.daylight.source, 'external-analyzer-hook');
  assert.deepEqual(report.rooms[0].sampling, { stepMin: 60, cell: 1000, maxCells: 40, workplane: 850 });
  assert.equal(report.rooms[0].daylight.model, 'cie-overcast-concept/1');
  assert.deepEqual(report.rooms[0].daylight.confidence, {
    level: 'medium', score: 0.65, reasons: ['Геометрия задана'],
  });
  assert.deepEqual(report.rooms[0].daylight.assumptions, {
    sky: 'CIE overcast', externalLux: 10_000, workplane: 850,
    transmission: {
      defaultGlass: 0.7, frameFactor: 0.8, maintenanceFactor: 0.9,
      windows: [{ openingId: 'window-test', glass: 0.72, effective: 0.5184 }],
    },
    interiorReflectance: 0.5, samplesPerWindow: 16,
    reflections: 'Усреднённые', shading: 'Непрозрачные объёмы', skyVisibility: 'Только через окна',
  });
  assert.deepEqual(report.rooms[0].daylight.thresholds, { daylightFactor: 2, lux: 300 });
});

test('подтверждённые координаты без направления севера остаются оценкой', () => {
  const { project } = reportProject();
  project.site.north = null;
  const report = buildSolarReport(project, { ...fast, months: [6] });
  assert.deepEqual(report.site, { lat: 43.238, lon: 76.889, tz: 5, north: null, verified: false });
  assert.equal(report.rooms[0].quality, 'estimated');
});

test('пустой проект даёт корректную нулевую сводку', () => {
  const project = createProject('Пустой');
  const report = buildSolarReport(project, { ...fast, months: [6] });
  assert.deepEqual(report.rooms, []);
  assert.deepEqual(report.progress, { done: 0, total: 0 });
  assert.equal(report.cancelled, false);
  assert.deepEqual(report.summary, {
    rooms: 0,
    regulatedRooms: 0,
    glazingMeets: 0,
    glazingBelow: 0,
    verifiedRooms: 0,
    estimatedRooms: 0,
    unavailableRooms: 0,
  });
});

test('комнаты следуют порядку этаж → экспликация; шахты и террасы исключены', () => {
  const project = createProject('Порядок');
  project.site.solarVerified = true;
  project.levels[0].name = 'Земля';
  const right = createRoom('bedroom', 5000, 0, 3000, 3000);
  right.name = 'Справа';
  const lower = createRoom('bedroom', 0, 5000, 3000, 3000);
  lower.name = 'Снизу';
  const left = createRoom('living', 0, 0, 3000, 3000);
  left.name = 'Слева';
  const terrace = createRoom('terrace', 9000, 0, 3000, 3000);
  const shaft = createRoom('shaft', 1000, 1000, 500, 500);
  project.rooms.push(lower, right, terrace, shaft, left);

  const upper = createLevel('Верх', 3000, 3000, 'L2-report');
  const upperRoom = createRoom('bedroom', 0, 0, 4000, 4000);
  upperRoom.name = 'Наверху';
  upper.rooms.push(upperRoom);
  project.levels.push(upper);

  const basement = createLevel('Подвал', -3000, 3000, 'LB-report');
  const basementRoom = createRoom('hall', 0, 0, 4000, 4000);
  basementRoom.name = 'В подвале';
  basement.rooms.push(basementRoom);
  project.levels.push(basement);

  const report = buildSolarReport(project, { ...fast, months: [6] });
  assert.deepEqual(report.rooms.map((room) => [room.levelName, room.name, room.number]), [
    ['Подвал', 'В подвале', '1.01'],
    ['Земля', 'Слева', '2.01'],
    ['Земля', 'Справа', '2.02'],
    ['Земля', 'Снизу', '2.05'],
    ['Верх', 'Наверху', '3.01'],
  ]);
  assert.equal(report.summary.rooms, 5);
});

test('открытая планировка явно отделяет площадь комнаты от общей зоны остекления', () => {
  const project = createProject('Открытая зона');
  project.site.solarVerified = true;
  const living = createRoom('living', 0, 0, 3000, 4000);
  const kitchen = createRoom('kitchen', 3100, 0, 3000, 4000);
  project.rooms.push(living, kitchen);
  project.wallOverrides[sharedKey(living.id, kitchen.id)] = { hidden: true };
  const opening = createOpening('window', kitchen.id, 1, 2000, 2400);
  opening.height = 2000;
  opening.sill = 300;
  project.openings.push(opening);

  const report = buildSolarReport(project, { ...fast, months: [6] });
  assert.equal(report.rooms.length, 2);
  for (const room of report.rooms) {
    assert.equal(room.area, 12);
    assert.equal(room.glazing.floorArea, 24);
    assert.equal(room.glazing.area, 4.8);
    assert.equal(room.glazingScope, 'open-plan-zone');
    assert.deepEqual(new Set(room.zoneRoomIds), new Set([living.id, kitchen.id]));
  }
});

test('ограничения параметров записываются, а фактическая плоскость берётся из анализа', () => {
  const { project } = reportProject();
  const low = buildSolarReport(project, {
    months: [6], stepMin: -100, cell: 1, maxCells: 1, workplane: -100,
  });
  assert.deepEqual(low.assumptions.directSun, {
    from: 0, to: 1440, stepMin: 5, requestedGridCell: 250, maxCells: 16, requestedWorkplane: 0,
    occluders: {
      treatment: 'opaque-year-round',
      roofsAndMasses: 'opaque',
      massVoids: 'subtract-overlap-from-solid-mass-shadow-and-never-cast-alone',
      treeCrowns: 'opaque-without-seasonality',
      translucentStructures: 'conservatively-opaque',
      terrain: 'flat-without-terrain-shadowing',
    },
  });
  assert.equal(low.rooms[0].sampling.workplane, 0);

  const high = buildSolarReport(project, {
    months: [6], stepMin: 500, cell: 50_000, maxCells: 50_000, workplane: 50_000,
  });
  assert.deepEqual(high.assumptions.directSun, {
    from: 0, to: 1440, stepMin: 60, requestedGridCell: 5000, maxCells: 600, requestedWorkplane: 50_000,
    occluders: {
      treatment: 'opaque-year-round',
      roofsAndMasses: 'opaque',
      massVoids: 'subtract-overlap-from-solid-mass-shadow-and-never-cast-alone',
      treeCrowns: 'opaque-without-seasonality',
      translucentStructures: 'conservatively-opaque',
      terrain: 'flat-without-terrain-shadowing',
    },
  });
  assert.equal(high.rooms[0].sampling.workplane, 2600);
});

test('CSV безопасен для Excel: BOM, ;, CRLF, запятая, кавычки и защита формул', () => {
  const { project } = reportProject();
  project.name = '  =HYPERLINK("https://example.test";"Проект")';
  let daylightCalls = 0;
  const report = buildSolarReport(project, {
    ...fast,
    daylightAnalyzer: () => {
      daylightCalls += 1;
      return { meanDaylightFactor: 2.35, meanLux: 470, coverage300: 0.75, confidence: 'concept' };
    },
  });
  assert.equal(daylightCalls, 1);
  assert.equal(report.rooms[0].daylight.meanLux, 470);

  const csv = buildSolarReportCsv(report);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.endsWith('\r\n'));
  assert.equal(csv.replaceAll('\r\n', '').includes('\n'), false);
  assert.match(csv, /Сезонная световая сводка \(2 реперных дня\);"' {2}=HYPERLINK/);
  assert.match(csv, /"Гостиная; ""юг"""/);
  assert.match(csv, /КЕО, %;Освещённость, лк;Охват ≥300 лк, %/);
  assert.match(csv, /2,35;470;75,0/);
  assert.match(csv, /Март;2026-03-21/);
  assert.match(csv, /Июнь;2026-06-21/);
  assert.match(csv, /Площадка;Широта;Долгота;Часовой пояс UTC;Север, °;Координаты и север подтверждены/);
  assert.match(csv, /;43,238000;76,889000;5,00;0,0;да/);
  assert.match(csv, /Консервативно непрозрачные круглый год/);
  assert.match(csv, /вычитающая масса вырезает отверстие в пределах своего 3D-объёма/);
  assert.ok(csv.includes(';'));
});

test('CSV отличает отсутствие данных прямого солнца от нулевого результата', () => {
  const { project, room } = reportProject();
  room.name = 'Без данных';
  project.site.location = { lat: null, lon: null, tz: null };
  project.site.solarVerified = false;
  const report = buildSolarReport(project, { ...fast, months: [6] });
  assert.equal(report.rooms[0].quality, 'unavailable');

  const csv = buildSolarReportCsv(report);
  const lines = csv.slice(1).split('\r\n');
  const summary = lines.find((line) => line.startsWith('1 этаж;1.01;Без данных;'));
  const monthly = lines.find((line) => line.includes(';Июнь;2026-06-21;'));
  assert.ok(summary);
  assert.ok(monthly);
  const summaryCells = summary.split(';');
  assert.deepEqual(summaryCells.slice(9, 14), ['', '', '', '', '']);
  assert.equal(summaryCells.at(-1), 'нет координат');
  const monthCells = monthly.split(';');
  assert.deepEqual(monthCells.slice(5, 10), ['', '', '', '', '']);
  assert.equal(monthCells.at(-1), 'нет данных');
});

test('daylight и JSON не пропускают NaN/Infinity', () => {
  const { project } = reportProject();
  const report = buildSolarReport(project, {
    ...fast,
    daylightAnalyzer: () => ({ meanDaylightFactor: Number.NaN, meanLux: Infinity, coverage300: -Infinity }),
  });
  assert.equal(report.rooms[0].daylight.meanDaylightFactor, null);
  assert.equal(report.rooms[0].daylight.meanLux, null);
  assert.equal(report.rooms[0].daylight.coverage300, null);
  assert.equal(report.rooms[0].daylight.confidence, null);
  assert.equal(report.rooms[0].daylight.model, null);
  assertFiniteNumbers(report);

  const json = buildSolarReportJson({ ...report, bad: { nan: Number.NaN, infinity: Infinity } }, { pretty: false });
  assert.equal(json.includes('\n'), false);
  assert.equal(json.includes('NaN'), false);
  assert.equal(json.includes('Infinity'), false);
  assert.deepEqual(JSON.parse(json).bad, { nan: null, infinity: null });
  assert.equal(JSON.parse(json).schema, SOLAR_REPORT_SCHEMA);
});

test('progress и программный cancel дают явный частичный отчёт', () => {
  const { project } = reportProject();
  const second = createRoom('bedroom', 7000, 0, 4000, 4000);
  project.rooms.push(second);
  const progress = [];
  let stop = false;
  const report = buildSolarReport(project, {
    ...fast,
    months: [1, 3, 6],
    onProgress: (item) => { progress.push(item); if (item.done === 2) stop = true; },
    shouldCancel: () => stop,
  });
  assert.equal(report.cancelled, true);
  assert.equal(report.progress.done, 2);
  assert.equal(report.progress.total, 6);
  assert.equal(progress.length, 2);
  assert.equal(report.rooms.length, 1);
  assert.equal(report.rooms[0].months.length, 2);
});

test('async-сводка равна sync, уступает scheduler и считает снимок проекта', async () => {
  const { project, room, opening } = reportProject();
  const generatedAt = '2026-11-16T12:00:00.000Z';
  const daylightAnalyzer = () => ({
    meanDaylightFactor: 2.4, meanLux: 240, coverage300: 0.45,
    method: 'test-daylight', confidence: { level: 'medium', score: 0.6 },
  });
  const syncProgress = [];
  const sync = buildSolarReport(project, {
    ...fast, generatedAt, daylightAnalyzer,
    onProgress: (value) => syncProgress.push(value),
  });

  const asyncProgress = [];
  const phases = [];
  let mutated = false;
  const asyncReport = await buildSolarReportAsync(project, {
    ...fast, generatedAt, daylightAnalyzer, yieldEvery: 1,
    onProgress: (value) => asyncProgress.push(value),
    async yieldControl(event) {
      phases.push(event.phase);
      if (!mutated) {
        mutated = true;
        project.name = 'Изменён после yield';
        room.name = 'Новое имя';
        opening.width = 500;
      }
      await Promise.resolve();
    },
  });

  assert.equal(mutated, true, 'scheduler был вызван');
  assert.deepEqual(asyncProgress, syncProgress);
  assert.deepEqual(asyncReport, sync, 'async и sync дают один отчёт из одного снимка');
  assert.ok(phases.includes('direct'));
  assert.ok(phases.includes('before-daylight'));
  assert.ok(phases.includes('after-daylight'));
});

test('async-сводка даёт macrotask отменить расчёт после видимого progress', async () => {
  const { project } = reportProject();
  project.rooms.push(createRoom('bedroom', 7000, 0, 4000, 4000));
  const progress = [];
  let stop = false;
  const timer = new Promise((resolve) => {
    setTimeout(() => { stop = true; resolve(); }, 0);
  });
  const report = await buildSolarReportAsync(project, {
    ...fast, months: [1, 2, 3, 4], yieldEvery: 1,
    onProgress: (value) => progress.push(value),
    shouldCancel: () => stop,
  });
  await timer;

  assert.equal(stop, true);
  assert.equal(report.cancelled, true);
  assert.equal(report.progress.done, 1);
  assert.equal(report.progress.total, 8);
  assert.equal(progress.length, 1);
  assert.equal(report.rooms.length, 1);
  assert.equal(report.rooms[0].months.length, 1);
});

test('async-отмена на yield перед daylight не запускает тяжёлый анализатор', async () => {
  const { project } = reportProject();
  const phases = [];
  let stop = false;
  let daylightCalls = 0;
  const report = await buildSolarReportAsync(project, {
    ...fast, months: [6], yieldEvery: 48, yieldBudgetMs: 250,
    daylightAnalyzer: () => { daylightCalls += 1; return { meanLux: 100 }; },
    shouldCancel: () => stop,
    async yieldControl(event) {
      phases.push(event.phase);
      if (event.phase === 'before-daylight') stop = true;
    },
  });

  assert.deepEqual(phases, ['before-daylight']);
  assert.equal(daylightCalls, 0);
  assert.equal(report.cancelled, true);
  assert.equal(report.progress.done, 1);
  assert.equal(report.rooms.length, 1);
  assert.equal(report.rooms[0].daylight, null);
});

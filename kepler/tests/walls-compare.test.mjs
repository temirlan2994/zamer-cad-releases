// Этап A стен v2 (docs/walls-v2-architecture.md, 4.4): сравнение с v1 на
// фикстурах, шаблонах и проекте пользователя — разница областей только в
// зонах известных дефектов v1 (c — угол в соседе, e — заплатки/удлинения),
// ни один проём не сдвинут, записи own/shared совпадают (кроме концов у
// шахт: v1 удлиняет угол до обрезки шахтой). Плюс скорость: 40 комнат < 20 мс
// на эталонной машине (на медленных — пропорционально больше).
import test from 'node:test';
import assert from 'node:assert/strict';

import { compareCases, compareWalls } from '../scripts/compare-walls.mjs';
import { deriveWalls, deriveWallsV1, deriveWallsV2, wallOutline, wallsEngine } from '../core/walls.js';
import { createProject, createRoom } from '../core/model.js';

const cases = await compareCases();

for (const [name, project] of cases) {
  test(`v1 ↔ v2: ${name}`, () => {
    const r = compareWalls(project);
    assert.ok(r.diffOther < 1e-4, `разница вне зон дефектов: ${r.diffOther} м² ${r.otherSample.join('; ')}`);
    assert.deepEqual(r.shifted, [], 'проёмы сдвинулись');
    const hasShaft = project.rooms.some((room) => room.type === 'shaft');
    if (!hasShaft) {
      assert.deepEqual(r.records.onlyV1, [], 'записи только в v1');
      assert.deepEqual(r.records.onlyV2, [], 'записи только в v2');
    }
  });
}

test('v2: куски не пересекаются и у каждой записи есть поля v1', () => {
  const [, project] = cases.find(([name]) => name.startsWith('user-house'));
  const v2 = deriveWallsV2(project);
  const fields = ['key', 'kind', 'orient', 'rooms', 'sides', 'from', 'to', 'edge', 'thickness', 'band', 'center', 'wallType', 'hidden'];
  for (const w of v2) {
    for (const f of fields) assert.ok(f in w, `${w.key}: нет поля ${f}`);
    assert.ok(Array.isArray(w.rects) && Array.isArray(w.polys));
    assert.ok(w.kind === 'own' || w.kind === 'shared');
  }
  const outline = wallOutline(v2);
  assert.ok(outline.some((c) => !c.hole), 'есть внешний контур');
});

test('переключатель: по умолчанию v2, settings.wallsEngine / KEPLER_WALLS — v1 (устаревший)', () => {
  const p = cases[0][1];
  const env = process.env.KEPLER_WALLS;
  const own = p.settings.wallsEngine;
  // Проект с геттерами активного этажа: настройку меняем на месте.
  const withEngine = (engine, fn) => {
    if (engine) p.settings.wallsEngine = engine; else delete p.settings.wallsEngine;
    try { return fn(); } finally { if (own === undefined) delete p.settings.wallsEngine; else p.settings.wallsEngine = own; }
  };
  try {
    delete process.env.KEPLER_WALLS;
    withEngine(null, () => {
      assert.equal(wallsEngine(p), 'v2');
      assert.ok(deriveWalls(p).every((w) => w.rects));
    });
    withEngine('v1', () => {
      assert.equal(wallsEngine(p), 'v1');
      assert.equal(deriveWalls(p).some((w) => w.rects), false);
    });
    withEngine('v2', () => assert.equal(wallsEngine(p), 'v2'));
    process.env.KEPLER_WALLS = 'v1';
    withEngine(null, () => {
      assert.equal(wallsEngine(p), 'v1');
      assert.equal(deriveWalls(p).some((w) => w.rects), false);
    });
    process.env.KEPLER_WALLS = 'v2';
    withEngine('v1', () => {
      assert.equal(wallsEngine(p), 'v2');
      assert.ok(deriveWalls(p).every((w) => w.rects));
    });
  } finally {
    if (env === undefined) delete process.env.KEPLER_WALLS; else process.env.KEPLER_WALLS = env;
  }
});

// Худший случай: 40 комнат 8×5 со своими ширинами в каждом ряду (сетка не
// выравнивается), половина — с угловым вырезом.
function fortyRooms() {
  const p = createProject('40 комнат');
  let seq = 0;
  for (let row = 0; row < 5; row += 1) {
    let x = row * 130;
    for (let col = 0; col < 8; col += 1) {
      const w = 2600 + ((row * 7 + col * 13) % 9) * 110;
      const r = createRoom('bedroom', x, row * 3600, w, 3500);
      seq += 1;
      r.id = `r${seq}`;
      if ((row + col) % 2) r.notch = { corner: ['nw', 'ne', 'se', 'sw'][(row + col) % 4], w: 900 + col * 10, h: 900 + row * 10 };
      p.rooms.push(r);
      x += w + 100;
    }
  }
  return p;
}

// Бюджет 20 мс задан для обычного рабочего компьютера. Общие раннеры CI
// в несколько раз медленнее, поэтому бюджет масштабируется по эталонной
// нагрузке: на машине не медленнее эталона остаётся ровно 20 мс.
const CALIBRATION_REFERENCE_MS = 70;

function calibrationWorkload() {
  const values = new Float64Array(200000);
  let acc = 0;
  for (let k = 0; k < 20; k += 1) {
    for (let i = 0; i < values.length; i += 1) {
      values[i] = Math.sqrt(i * k + acc);
      acc += values[i] % 3;
    }
  }
  return acc;
}

function wallBudgetMs() {
  calibrationWorkload(); // прогрев JIT
  const times = [];
  for (let i = 0; i < 5; i += 1) {
    const t0 = performance.now();
    calibrationWorkload();
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  return 20 * Math.max(1, times[2] / CALIBRATION_REFERENCE_MS);
}

test('v2: 40 комнат быстрее 20 мс (с поправкой на скорость машины)', () => {
  const budget = wallBudgetMs();
  const p = fortyRooms();
  for (let i = 0; i < 3; i += 1) deriveWallsV2(p); // прогрев JIT
  const times = [];
  for (let i = 0; i < 7; i += 1) {
    const t0 = performance.now();
    deriveWallsV2(p);
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const median = times[3];
  assert.ok(median < budget, `медиана ${median.toFixed(1)} мс, бюджет ${budget.toFixed(1)} мс`);
  assert.ok(deriveWallsV1(p).length > 0);
});

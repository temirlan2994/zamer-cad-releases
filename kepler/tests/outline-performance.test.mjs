// Контур размерных цепочек строится на каждом читаемом кадре плана.
// Нерегулярные координаты раньше превращали его в O(rooms³): каждая
// ячейка сжатой сетки снова перебирала все помещения.
import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

import { createProject, createRoom } from '../core/model.js';
import { computeBuildingOutline } from '../core/rooms.js';

function irregularRooms(count) {
  const project = createProject(`${count} помещений`);
  const cols = Math.ceil(Math.sqrt(count));
  for (let i = 0; i < count; i += 1) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const room = createRoom(
      'bedroom',
      col * 4300 + row * 37 + (i % 3) * 17,
      row * 4300 + col * 29 + (i % 5) * 13,
      2600 + (i * 137) % 800,
      2800 + (i * 211) % 900,
    );
    room.id = `room-${i}`;
    project.rooms.push(room);
  }
  return project;
}

// Общий CI бывает заметно медленнее рабочего компьютера. Небольшая CPU-
// калибровка оставляет тест строгим к алгоритму, а не к конкретной машине.
function calibrationMs() {
  const workload = () => {
    const values = new Float64Array(100000);
    let acc = 0;
    for (let pass = 0; pass < 10; pass += 1) {
      for (let i = 0; i < values.length; i += 1) {
        values[i] = Math.sqrt(i * pass + acc);
        acc += values[i] % 3;
      }
    }
    return acc;
  };
  workload();
  const times = [];
  for (let i = 0; i < 3; i += 1) {
    const started = performance.now();
    workload();
    times.push(performance.now() - started);
  }
  return times.sort((a, b) => a - b)[1];
}

test('наружный контур 240 нерегулярных помещений остаётся интерактивным', () => {
  const project = irregularRooms(240);
  computeBuildingOutline(project, 250); // прогрев JIT
  const samples = [];
  for (let i = 0; i < 5; i += 1) {
    // Геометрия меняется: замеряем именно пересборку, а не
    // быстрое повторное чтение из кеша.
    project.rooms.at(-1).x += 1;
    const started = performance.now();
    const edges = computeBuildingOutline(project, 250);
    samples.push(performance.now() - started);
    assert.ok(edges.length >= project.rooms.length * 2, 'контур действительно построен');
  }
  samples.sort((a, b) => a - b);
  const median = samples[2];
  const budget = 60 * Math.max(1, calibrationMs() / 45);
  assert.ok(median < budget, `медиана ${median.toFixed(1)} мс, бюджет ${budget.toFixed(1)} мс`);
});

test('допуск контура по-прежнему склеивает субмиллиметровый зазор', () => {
  const project = createProject('микрозазор');
  const a = createRoom('bedroom', 0, 0, 3000, 3000);
  const b = createRoom('bedroom', 3000.8, 0, 3000, 3000);
  a.id = 'a'; b.id = 'b';
  project.rooms.push(a, b);
  assert.equal(computeBuildingOutline(project, 0).length, 4);
});

test('кеш контура не скрывает мутацию комнаты', () => {
  const project = createProject('кеш');
  const room = createRoom('bedroom', 0, 0, 3000, 3000);
  room.id = 'room';
  project.rooms.push(room);
  const before = computeBuildingOutline(project, 0);
  assert.ok(before.some((edge) => edge.orient === 'v' && edge.at === 3000));
  room.w = 4200;
  const after = computeBuildingOutline(project, 0);
  assert.ok(after.some((edge) => edge.orient === 'v' && edge.at === 4200));
  assert.notStrictEqual(after, before, 'изменённая геометрия получила новый массив рёбер');
});

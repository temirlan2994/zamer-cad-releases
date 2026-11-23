// Broad phase для стен обязан быть только фильтром кандидатов: окончательная
// геометрия по-прежнему определяется точными рёбрами Г/outline-комнат.
import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

import { DEFAULT_PARTITION } from '../core/catalog.js';
import { findNearMissGaps } from '../core/gaps.js';
import { createProject, createRoom } from '../core/model.js';
import { roomBoundaryEdges } from '../core/room-shape.js';
import { deriveWallsV2, findAdjacencies, sharedKey } from '../core/walls.js';

function bruteAdjacencies(rooms, sharedGap, overrides = null) {
  const result = [];
  for (let i = 0; i < rooms.length; i += 1) {
    for (let j = i + 1; j < rooms.length; j += 1) {
      const a = rooms[i];
      const b = rooms[j];
      if ((a.parentId || null) !== (b.parentId || null)) continue;
      const own = Number(overrides?.[sharedKey(a.id, b.id)]?.thickness);
      const pairGap = own > 0 ? own : sharedGap;
      for (const [first, second] of [[a, b], [b, a]]) {
        for (const edgeA of roomBoundaryEdges(first)) {
          for (const edgeB of roomBoundaryEdges(second)) {
            if (edgeA.orient !== edgeB.orient || edgeA.outward === edgeB.outward) continue;
            const gap = (edgeB.edge - edgeA.edge) * edgeA.outward;
            if (Math.abs(gap - pairGap) > 1) continue;
            const from = Math.max(edgeA.from, edgeB.from);
            const to = Math.min(edgeA.to, edgeB.to);
            if (to - from <= 1) continue;
            result.push({
              a: first.id, b: second.id, sideA: edgeA.side, sideB: edgeB.side,
              orient: edgeA.orient, edge: edgeA.edge, gap, from, to,
            });
          }
        }
      }
    }
  }
  return result;
}

function adjacencyShape(adjacencies) {
  return adjacencies.map((adj) => ({
    a: adj.a.id, b: adj.b.id, sideA: adj.sideA, sideB: adj.sideB,
    orient: adj.edgeA.orient, edge: adj.edgeA.edge, gap: adj.gap,
    from: adj.from, to: adj.to,
  }));
}

function shapedProject() {
  const project = createProject('broad phase');
  const outline = createRoom('living', 0, 0, 6000, 6000);
  outline.id = 'outline';
  outline.outline = [
    { x: 0, y: 0 }, { x: 3000, y: 0 }, { x: 3000, y: 3000 },
    { x: 6000, y: 3000 }, { x: 6000, y: 6000 }, { x: 0, y: 6000 },
  ];
  const inCut = createRoom('bedroom', 3100, 0, 2900, 2900);
  inCut.id = 'in-cut';
  const below = createRoom('bedroom', 0, 6100, 6000, 3000);
  below.id = 'below';

  const notch = createRoom('living', 10000, 0, 6000, 6000);
  notch.id = 'notch';
  notch.notch = { corner: 'ne', w: 3000, h: 3000 };
  const notchMate = createRoom('bedroom', 13100, 0, 2900, 2900);
  notchMate.id = 'notch-mate';

  const thickA = createRoom('bedroom', 20000, 0, 3000, 3000);
  thickA.id = 'thick-a';
  const thickB = createRoom('bedroom', 23300, 0, 3000, 3000);
  thickB.id = 'thick-b';
  project.wallOverrides[sharedKey(thickA.id, thickB.id)] = { thickness: 300 };

  for (let i = 0; i < 24; i += 1) {
    const far = createRoom('bedroom', 50000 + (i % 6) * 7000, 50000 + Math.floor(i / 6) * 7000, 2500, 2600);
    far.id = `far-${i}`;
    project.rooms.push(far);
  }
  project.rooms.push(outline, inCut, below, notch, notchMate, thickA, thickB);
  return project;
}

test('broad phase сохраняет точные adjacency для Г, outline и своей толщины', () => {
  const project = shapedProject();
  const exact = bruteAdjacencies(project.rooms, DEFAULT_PARTITION, project.wallOverrides);
  const actual = adjacencyShape(findAdjacencies(project.rooms, DEFAULT_PARTITION, project.wallOverrides));
  assert.ok(exact.length >= 5, 'фикстура действительно содержит разные стыки');
  assert.deepEqual(actual, exact);
});

test('near-miss внутри выреза outline не теряется из-за его bbox', () => {
  const project = createProject('outline near miss');
  const room = createRoom('living', 0, 0, 6000, 6000);
  room.id = 'outline';
  room.outline = [
    { x: 0, y: 0 }, { x: 3000, y: 0 }, { x: 3000, y: 3000 },
    { x: 6000, y: 3000 }, { x: 6000, y: 6000 }, { x: 0, y: 6000 },
  ];
  const neighbour = createRoom('bedroom', 3150, 0, 2850, 2850);
  neighbour.id = 'neighbour';
  project.rooms.push(room, neighbour);
  const gaps = findNearMissGaps(project, { move: false });
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].key, sharedKey(room.id, neighbour.id));
  assert.equal(gaps[0].gap, 150);
});

function distantProject(count) {
  const project = createProject(`${count} distant rooms`);
  for (let i = 0; i < count; i += 1) {
    const room = createRoom('bedroom', (i % 20) * 5200, Math.floor(i / 20) * 5200, 4000, 4000);
    room.id = `room-${i}`;
    project.rooms.push(room);
  }
  return project;
}

function medianMs(fn) {
  for (let i = 0; i < 2; i += 1) fn();
  const samples = [];
  for (let i = 0; i < 5; i += 1) {
    const started = performance.now();
    fn();
    samples.push(performance.now() - started);
  }
  return samples.sort((a, b) => a - b)[2];
}

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
  return medianMs(workload);
}

test('200 далёких комнат не возвращают стеновой анализ к попарной exact-геометрии', () => {
  const project = distantProject(200);
  const adjacencyMs = medianMs(() => findAdjacencies(project.rooms, DEFAULT_PARTITION));
  const gapsMs = medianMs(() => findNearMissGaps(project, { move: false }));
  const wallsMs = medianMs(() => deriveWallsV2(project));
  const scale = Math.max(1, calibrationMs() / 35);
  assert.ok(adjacencyMs < 25 * scale, `adjacency: ${adjacencyMs.toFixed(1)} мс`);
  assert.ok(gapsMs < 25 * scale, `near-miss: ${gapsMs.toFixed(1)} мс`);
  // wallSegments всё ещё материализует геометрию каждой комнаты; здесь нужен
  // широкий бюджет, а строгий регресс-бюджет относится к pair broad phase.
  assert.ok(wallsMs < 180 * scale, `deriveWallsV2: ${wallsMs.toFixed(1)} мс`);
});

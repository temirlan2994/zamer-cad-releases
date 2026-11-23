import test from 'node:test';
import assert from 'node:assert/strict';

import {
  planShadowCullScope, planViewportBox, planVisibleRoomIds, projectPoint, rectInPlanViewport,
} from '../render.js';

test('viewport плана учитывает экранный запас и отсекает далёкую геометрию', () => {
  const view = { scale: 0.1, panX: 500, panY: 400, rotation: 0 };
  const box = planViewportBox(view, 1000, 800, 100);
  assert.deepEqual(box, { minX: -6000, maxX: 6000, minY: -5000, maxY: 5000 });
  assert.equal(rectInPlanViewport({ x: -3000, y: -2000, w: 1000, h: 1000 }, box), true);
  assert.equal(rectInPlanViewport({ x: 7000, y: 0, w: 500, h: 500 }, box), false);
  assert.equal(rectInPlanViewport({ x: 6000, y: 0, w: 1, h: 1 }, box), true, 'касание границы не мигает');
});

test('viewport остаётся корректным при повороте вида', () => {
  const view = { scale: 0.08, panX: 420, panY: 310, rotation: Math.PI / 4 };
  const box = planViewportBox(view, 840, 620, 80);
  const centerWorld = { x: 1200, y: -800 };
  const centerScreen = projectPoint(view, centerWorld.x, centerWorld.y);
  const visible = centerScreen.x >= -80 && centerScreen.x <= 920
    && centerScreen.y >= -80 && centerScreen.y <= 700;
  assert.equal(rectInPlanViewport({ x: centerWorld.x - 1, y: centerWorld.y - 1, w: 2, h: 2 }, box), visible);
  assert.equal(rectInPlanViewport({ x: 100_000, y: 100_000, w: 1000, h: 1000 }, box), false);
});

test('на приближённом плане число кандидатов зависит от экрана, а не от проекта', () => {
  const box = planViewportBox({ scale: 0.2, panX: 400, panY: 300, rotation: 0 }, 800, 600, 120);
  const rooms = Array.from({ length: 240 }, (_, index) => ({
    x: index * 5000, y: 0, w: 4000, h: 3500,
  }));
  const visible = rooms.filter((room) => rectInPlanViewport(room, box));
  assert.ok(visible.length < 5, `видимых кандидатов: ${visible.length}`);
});

test('владелец толстой стены не отсекается у края на максимальном масштабе', () => {
  const viewport = { minX: -200, minY: -200, maxX: 1700, maxY: 1300 };
  const room = { id: 'edge-room', x: -4001, y: 100, w: 3800, h: 3000 };
  assert.equal(rectInPlanViewport(room, viewport), false, 'пол уже за 120 px запаса');
  const visibleWall = {
    rooms: [room.id],
    band: { x: -201, y: 100, w: 400, h: 3000 },
  };
  const ids = planVisibleRoomIds([room], [visibleWall], viewport);
  assert.equal(ids.has(room.id), true, 'комната остаётся контекстом рисования её стены');
});

test('тени берут источники за экраном и не меняют scope при малом панорамировании', () => {
  const project = {};
  const viewport = { minX: 0, minY: 0, maxX: 12_000, maxY: 8_000 };
  const scope = planShadowCullScope(null, viewport, project, 'L1');
  assert.ok(scope.source.minX <= scope.coverage.minX - 6200);
  assert.ok(scope.source.maxX >= scope.coverage.maxX + 6200);
  assert.equal(planShadowCullScope(scope, {
    minX: 1000, minY: 500, maxX: 13_000, maxY: 8500,
  }, project, 'L1'), scope, 'малый сдвиг использует тот же кеш');
  assert.notEqual(planShadowCullScope(scope, {
    minX: 10_000, minY: 0, maxX: 22_000, maxY: 8_000,
  }, project, 'L1'), scope, 'выход из coverage создаёт новое окно');
  assert.notEqual(planShadowCullScope(scope, viewport, {}, 'L1'), scope, 'другой проект не делит scope');
});

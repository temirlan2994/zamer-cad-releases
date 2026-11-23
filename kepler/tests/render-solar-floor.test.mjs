import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createRoom } from '../core/model.js';
import {
  bindLightAnalysisRedraw,
  currentDaylightAnalysis,
  levelLightAnalysisProgress,
  prepareLevelLightAnalysis,
} from '../ui/render-solar.js';
import { state } from '../ui/state.js';

test('поэтажный свет автоматически рассчитывает все комнаты короткой очередью', async () => {
  const before = {
    project: state.project,
    solarAnalysis: state.solarAnalysis,
    analytics: state.analytics,
  };
  const project = createProject('Большой этаж');
  for (let index = 0; index < 32; index += 1) {
    project.rooms.push(createRoom('living', (index % 8) * 4200, Math.floor(index / 8) * 4200, 4000, 4000));
  }
  state.project = project;
  state.analytics = { dirty: false, running: false, revision: 701 };
  state.solarAnalysis = {
    on: true,
    roomId: null,
    mode: 'daylight',
    scope: 'level',
    levelId: project.activeLevel,
  };
  let redraws = 0;
  bindLightAnalysisRedraw(() => { redraws += 1; });

  try {
    const promise = prepareLevelLightAnalysis(project.activeLevel, 'daylight');
    const queued = levelLightAnalysisProgress(project.activeLevel, 'daylight');
    assert.equal(queued.total, 32);
    assert.equal(queued.ready, 0);
    assert.equal(queued.pending, 32);

    const results = await promise;
    assert.equal(results.length, 32);
    assert.ok(results.every((result) => result?.roomId));
    assert.ok(results.every((result) => result.points.length <= 196));
    assert.equal(redraws, 32, 'каждая готовая комната запрашивает следующий кадр');

    const ready = levelLightAnalysisProgress(project.activeLevel, 'daylight');
    assert.deepEqual(ready, { total: 32, ready: 32, pending: 0 });
    assert.equal(currentDaylightAnalysis(project.rooms[17].id)?.roomId, project.rooms[17].id);

    // Переключение вида/этажа повышает общую analytics revision, хотя
    // световая геометрия не менялась. Fingerprint должен вернуть тот же
    // token и все готовые карты без повторной очереди.
    state.analytics.revision += 1;
    const redrawsBeforeReuse = redraws;
    const reused = await prepareLevelLightAnalysis(project.activeLevel, 'daylight');
    assert.equal(reused.length, 32);
    assert.equal(redraws, redrawsBeforeReuse, 'неизменный этаж не пересчитывается');
    assert.deepEqual(levelLightAnalysisProgress(project.activeLevel, 'daylight'), {
      total: 32, ready: 32, pending: 0,
    });
  } finally {
    bindLightAnalysisRedraw(null);
    state.project = before.project;
    state.solarAnalysis = before.solarAnalysis;
    state.analytics = before.analytics;
  }
});

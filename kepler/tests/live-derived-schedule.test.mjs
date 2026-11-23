import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LIVE_GEOMETRY_ROOM_LIMIT, cancelLiveDerived, deferLiveGeometry, liveEat, scheduleLiveDerived,
} from '../ui/block-gesture.js';
import { state } from '../ui/state.js';

test('производные жеста объединяются в один расчёт на кадр', () => {
  const previousRequest = globalThis.requestAnimationFrame;
  const previousCancel = globalThis.cancelAnimationFrame;
  const callbacks = new Map();
  let seq = 0;
  globalThis.requestAnimationFrame = (callback) => {
    seq += 1;
    callbacks.set(seq, callback);
    return seq;
  };
  globalThis.cancelAnimationFrame = (id) => callbacks.delete(id);
  try {
    const drag = {};
    let runs = 0;
    assert.equal(scheduleLiveDerived(drag, () => { runs += 1; }), true);
    assert.equal(scheduleLiveDerived(drag, () => { runs += 1; }), false, 'второй pointermove того же кадра объединён');
    assert.equal(callbacks.size, 1);
    callbacks.get(1)();
    assert.equal(runs, 1);

    assert.equal(scheduleLiveDerived(drag, () => { runs += 1; }), true, 'следующий кадр может обновить геометрию');
    callbacks.get(2)();
    assert.equal(runs, 2);
  } finally {
    if (previousRequest === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = previousRequest;
    if (previousCancel === undefined) delete globalThis.cancelAnimationFrame;
    else globalThis.cancelAnimationFrame = previousCancel;
  }
});

test('завершение жеста отменяет отложенный расчёт', () => {
  const previousRequest = globalThis.requestAnimationFrame;
  const previousCancel = globalThis.cancelAnimationFrame;
  const callbacks = new Map();
  globalThis.requestAnimationFrame = (callback) => { callbacks.set(7, callback); return 7; };
  globalThis.cancelAnimationFrame = (id) => callbacks.delete(id);
  try {
    const drag = {};
    let runs = 0;
    scheduleLiveDerived(drag, () => { runs += 1; });
    cancelLiveDerived(drag);
    assert.equal(callbacks.size, 0);
    assert.equal(scheduleLiveDerived(drag, () => { runs += 1; }), false);
    assert.equal(runs, 0, 'завершённый жест не обновляет устаревшую геометрию');
  } finally {
    if (previousRequest === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = previousRequest;
    if (previousCancel === undefined) delete globalThis.cancelAnimationFrame;
    else globalThis.cancelAnimationFrame = previousCancel;
  }
});

test('большой план откладывает live carve и стены до завершения жеста', () => {
  const previousProject = state.project;
  const rooms = Array.from({ length: LIVE_GEOMETRY_ROOM_LIMIT + 1 }, (_, index) => ({ id: `r${index}` }));
  state.project = { rooms };
  try {
    const drag = {};
    let derivedRuns = 0;
    assert.equal(deferLiveGeometry(state.project), true);
    assert.equal(scheduleLiveDerived(drag, () => { derivedRuns += 1; }), false);
    assert.equal(liveEat(drag, { touched: ['r0'] }), null);
    assert.equal(derivedRuns, 0);
    assert.equal(drag.derivedDeferred, true);
    assert.equal(drag.eatDeferred, true);

    // Ровно на пороге обычный live-путь остаётся включённым.
    assert.equal(deferLiveGeometry({ rooms: rooms.slice(0, LIVE_GEOMETRY_ROOM_LIMIT) }), false);
    cancelLiveDerived(drag);
  } finally {
    state.project = previousProject;
  }
});

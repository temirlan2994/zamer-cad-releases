// Ландшафт на плане (ui/plan-landscape.js): умолчания, нормализация,
// отбор объектов по группам и «Только планировки».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PLAN_LS_DEFAULT, normalizePlanLs, planLandscapeObjects, planLandscapePref, planOnlyPref, setPlanLandscapePref,
} from '../ui/plan-landscape.js';
import { state } from '../ui/state.js';

const objs = [
  { id: 'a', kind: 'tree-pine' }, // plants
  { id: 'b', kind: 'parking-2' }, // covers
  { id: 'c', kind: 'bench' }, // objects
];

test('умолчания: ландшафт виден, тени, подписи и выноски — нет', () => {
  assert.deepEqual(normalizePlanLs(null), { ...PLAN_LS_DEFAULT });
  assert.deepEqual(normalizePlanLs({ on: false, plants: false, junk: 1 }), { ...PLAN_LS_DEFAULT, on: false, plants: false });
  assert.deepEqual(normalizePlanLs({ covers: 'да' }).covers, true, 'не булево — умолчание');
});

test('отбор по группам; выключено — пусто', () => {
  assert.deepEqual(planLandscapeObjects(objs, normalizePlanLs(null)).map((o) => o.id), ['a', 'b', 'c']);
  assert.deepEqual(planLandscapeObjects(objs, normalizePlanLs({ plants: false })).map((o) => o.id), ['b', 'c']);
  assert.deepEqual(planLandscapeObjects(objs, normalizePlanLs({ on: false })), []);
  assert.deepEqual(planLandscapeObjects([], normalizePlanLs(null)), []);
});

test('настройка в state; «Только планировки» снимает всё', () => {
  state.planLs = null;
  assert.equal(planLandscapePref().on, true);
  setPlanLandscapePref({ covers: false });
  assert.equal(state.planLs.covers, false);
  const off = planOnlyPref();
  assert.equal(off.on, false);
  assert.ok(Object.entries(off).every(([, v]) => v === false));
  assert.deepEqual(planLandscapeObjects(objs), []);
  state.planLs = null;
});

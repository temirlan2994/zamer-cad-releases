// Отображение и освещение вида (core/view-display.js): умолчания, проверка
// значений, у каждого вида своё, в проекте — только отличия от умолчаний.
import test from 'node:test';
import assert from 'node:assert/strict';
import { VIEW_DISPLAY_DEFAULT, normalizeViewDisplay, setViewDisplay, viewDisplay, viewIdOf } from '../core/view-display.js';

test('без записи — умолчания; чужие значения отбрасываются', () => {
  assert.deepEqual(viewDisplay({}, 'plan:L1'), VIEW_DISPLAY_DEFAULT);
  assert.deepEqual(normalizeViewDisplay({ rooms: 'pink', shadows: 'yes', length: 'long', light: 'fixed', extra: 1 }),
    { ...VIEW_DISPLAY_DEFAULT, length: 'long', light: 'fixed' });
});

test('у каждого вида своё; в проекте — только отличия, пусто — записи нет', () => {
  const p = { activeLevel: 'L1' };
  setViewDisplay(p, 'plan:L1', { rooms: 'gray', shadows: false });
  setViewDisplay(p, 'site', { sunShadow: false });
  assert.deepEqual(p.viewDisplay, { 'plan:L1': { rooms: 'gray', shadows: false }, site: { sunShadow: false } });
  assert.equal(viewDisplay(p, 'plan:L2').rooms, 'color', 'другой этаж — свои настройки');
  assert.equal(viewDisplay(p, 'plan:L1').light, 'sun');
  setViewDisplay(p, 'plan:L1', { rooms: 'color', shadows: true });
  setViewDisplay(p, 'site', { sunShadow: true });
  assert.equal('viewDisplay' in p, false, 'всё по умолчанию — поля нет');
});

test('вид режима: план — активного этажа, участок и ландшафт — свои', () => {
  const p = { activeLevel: 'L2' };
  assert.equal(viewIdOf(p, 'plan'), 'plan:L2');
  assert.equal(viewIdOf(p, 'site'), 'site');
  assert.equal(viewIdOf(p, 'landscape'), 'landscape');
});

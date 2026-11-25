// Каталог дверей и окон для библиотеки: пресеты только поверх существующих
// типов, категории, поиск, совпадение с параметрами инструмента.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  OPENING_CATEGORIES, OPENING_PRESETS, openingPresets, presetMatches, presetToOpening, searchOpeningPresets,
} from '../core/opening-catalog.js';
import { DOOR_TYPES, WINDOW_TYPES } from '../core/walls.js';
import { applyOpeningPreset, defaultOpeningPreset } from '../core/opening-preset.js';
import { glazedOpeningParts, setGlazedWindow } from '../core/glazed-openings.js';

test('«С дверью»: ровно три простых варианта, боковые окна выключены до выбора пользователя', () => {
  const list = openingPresets('window', 'with-door');
  assert.deepEqual(list.map((p) => p.title), ['Распашная', 'Раздвижная', 'Балконная дверь']);
  for (const preset of list) {
    const opening = applyOpeningPreset({ kind: 'window', offset: 2000 }, presetToOpening(preset));
    const door = glazedOpeningParts(opening)[0];
    assert.equal(glazedOpeningParts(opening).length, 1);
    Object.assign(opening, setGlazedWindow(opening, 'left', true));
    Object.assign(opening, setGlazedWindow(opening, 'right', true));
    const parts = glazedOpeningParts(opening);
    assert.equal(parts.length, 3);
    assert.deepEqual([parts[0].width, parts[0].height], [door.width, door.height]);
    const low = presetToOpening(preset, 2400);
    assert.ok(low.assembly.doorHeight <= low.height);
  }
});

test('пресеты — только типы модели, у каждой категории есть пресеты, id уникальны', () => {
  assert.equal(new Set(OPENING_PRESETS.map((p) => p.id)).size, OPENING_PRESETS.length);
  for (const p of OPENING_PRESETS) {
    const types = p.kind === 'door' ? DOOR_TYPES : WINDOW_TYPES;
    assert.ok(types[p.type], `${p.id}: тип ${p.type} есть в модели`);
    assert.ok(OPENING_CATEGORIES[p.kind].some((c) => c.id === p.cat), `${p.id}: категория`);
    assert.ok(p.width >= 300 && p.height >= 300, p.id);
    if (p.kind === 'door') assert.equal(p.sill, 0);
  }
  for (const kind of ['door', 'window']) {
    for (const cat of OPENING_CATEGORIES[kind]) assert.ok(openingPresets(kind, cat.id).length >= 2, `${kind}/${cat.id}`);
  }
  // Названия из постановки.
  const titles = OPENING_PRESETS.map((p) => p.title);
  for (const t of ['Дверь 800', 'Дверь 900', 'Входная 1000', 'Окно 1200×1400', 'Окно 1500×1400', 'Панорамное 2400×2100']) assert.ok(titles.includes(t), t);
});

test('поиск: по размеру, слову и типу; только свой вид проёма', () => {
  assert.ok(searchOpeningPresets('door', '900').every((p) => p.kind === 'door' && /900/.test(`${p.width}${p.title}`)));
  const entry = searchOpeningPresets('door', 'входная').map((p) => p.id);
  for (const p of openingPresets('door', 'entrance')) assert.ok(entry.includes(p.id), `${p.id} находится по слову «входная»`);
  assert.ok(searchOpeningPresets('window', 'в пол').every((p) => p.type === 'panoramic'));
  assert.equal(searchOpeningPresets('window', 'входная').length, 0);
  assert.equal(searchOpeningPresets('door', '').length, openingPresets('door').length);
  for (const size of ['800 × 2100 мм', '800x2100', '800 х 2100']) {
    assert.deepEqual(searchOpeningPresets('door', 'Межкомнатные ' + size).map((p) => p.id), ['door-800']);
  }
  assert.deepEqual(searchOpeningPresets('window', 'широкие 2100 x 1500 мм').map((p) => p.id), ['win-2100x1500']);
});

test('пресет → параметры инструмента → новый проём; окно не выше этажа', () => {
  const pano = OPENING_PRESETS.find((p) => p.id === 'pano-2400');
  const params = presetToOpening(pano, 3000);
  assert.deepEqual(params, { type: 'panoramic', width: 2400, height: 2100, sill: 100 });
  assert.ok(presetMatches(pano, params, 3000));
  assert.ok(!presetMatches(pano, { ...params, width: 1800 }, 3000));
  const low = presetToOpening(OPENING_PRESETS.find((p) => p.id === 'pano-3000'), 2500);
  assert.ok(low.sill + low.height <= 2100, 'над окном ≥ 400 мм');
  const opening = applyOpeningPreset({ kind: 'window', width: 1000 }, params);
  assert.equal(opening.width, 2400);
  assert.equal(opening.type, 'panoramic');
  const door = presetToOpening(OPENING_PRESETS.find((p) => p.id === 'entry-1000'));
  assert.deepEqual(door, { presetId: 'entry-1000', entryRole: 'main', type: 'single', width: 1000, height: 2100, sill: 0 });
  // Параметры двери по умолчанию — карточка «Дверь 900»? нет: ширина по умолчанию своя, совпадение — только точное.
  const def = defaultOpeningPreset('door');
  assert.equal(OPENING_PRESETS.filter((p) => presetMatches(p, def)).length <= 1, true);
});

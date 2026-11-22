// Типы помещений: категории, цвета, размеры; старые id на месте; ТЭП,
// нормы, IFC и экспорт JSON понимают новые типы.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ROOM_CATEGORIES, ROOM_TYPES, furnitureDef, isLivingType, isSummerRoom, roomCategory, roomColors, roomType, roomTypesByCategory,
} from '../core/catalog.js';
import { createProject, createRoom, deserializeProject, serializeProject } from '../core/model.js';
import { normsReport, roomChecks } from '../core/norms.js';
import { roomSchedule, scheduleTotals } from '../core/schedule.js';
import { tepReport, tepRows } from '../core/tep.js';
import { buildIfc } from '../core/ifc.js';
import { buildStructuredExport } from '../core/export.js';
import { needsOwnAccess } from '../core/rooms.js';

const OLD_IDS = ['living', 'kitchen', 'dining', 'bedroom', 'master-bedroom', 'bathroom', 'wardrobe-room', 'cabinet',
  'hall', 'corridor', 'stairs-room', 'shaft', 'garage', 'terrace', 'balcony'];
const NEW_IDS = ['kids-room', 'guest-bedroom', 'library', 'gym', 'kitchen-living', 'pantry', 'guest-wc', 'shower-room',
  'tub-room', 'sauna', 'hammam', 'boiler', 'laundry', 'storage', 'tech', 'workshop', 'entrance', 'vestibule', 'elevator',
  'veranda', 'porch', 'carport'];
const HEX = /^#[0-9a-f]{6}$/;

test('типы: у каждого категория, размеры, цвета, IFC-имя; id и названия без дублей', () => {
  const ids = new Set();
  const titles = new Set();
  for (const t of ROOM_TYPES) {
    assert.ok(roomCategory(t.cat), `${t.type}: категория`);
    assert.ok(t.w >= 1000 && t.h >= 1000, `${t.type}: размеры`);
    assert.ok(t.title && t.ifcName, `${t.type}: название и IFC-имя`);
    const c = roomColors(t.type);
    for (const k of ['light', 'dark', 'swatch', 'floor3d']) assert.match(c[k], HEX, `${t.type}: цвет ${k}`);
    for (const f of t.furniture) assert.ok(furnitureDef(f.kind), `${t.type}: мебель ${f.kind} есть в каталоге`);
    assert.ok(!ids.has(t.type) && !titles.has(t.title), `${t.type}: без дублей`);
    ids.add(t.type); titles.add(t.title);
  }
  assert.equal(roomTypesByCategory().reduce((s, g) => s + g.types.length, 0), ROOM_TYPES.length, 'все типы — в группах');
  for (const g of roomTypesByCategory()) assert.ok(g.types.length >= 3, `${g.title}: не пустая`);
});

test('старые id на месте, новые добавлены; котельная, постирочная, гостевой санузел, прихожая', () => {
  for (const id of [...OLD_IDS, ...NEW_IDS]) assert.ok(roomType(id), id);
  assert.equal(roomType('boiler').title, 'Котельная');
  assert.equal(roomType('laundry').title, 'Постирочная');
  assert.equal(roomType('guest-wc').title, 'Гостевой санузел');
  assert.equal(roomType('entrance').title, 'Прихожая');
  assert.equal(roomType('shaft').shaft, true);
  assert.equal(roomType('terrace').open, true);
});

test('цвета: категория — свой оттенок, внутри категории типы различаются; светлая и тёмная тема', () => {
  const lum = (h) => {
    const n = parseInt(h.slice(1), 16);
    return (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
  };
  for (const t of ROOM_TYPES) {
    const c = roomColors(t.type);
    assert.ok(lum(c.light) > 0.85, `${t.type}: светлый пол`);
    assert.ok(lum(c.dark) < 0.2, `${t.type}: тёмный пол`);
  }
  const firsts = ROOM_CATEGORIES.map((cat) => roomColors(ROOM_TYPES.find((t) => t.cat === cat.id).type).light);
  assert.equal(new Set(firsts).size, ROOM_CATEGORIES.length, 'категории различаются');
  assert.notEqual(roomColors('living').light, roomColors('master-bedroom').light);
  assert.match(roomColors('нет-такого').light, HEX, 'неизвестный тип — нейтральный цвет');
});

test('ТЭП: жилая / вспомогательная / летние по признакам типа', () => {
  const p = createProject();
  const add = (type, x) => { const r = createRoom(type, x, 0, 3000, 3000); p.rooms.push(r); return r; };
  add('kids-room', 0); add('boiler', 3100); add('veranda', 6200); add('porch', 9300); add('guest-wc', 12400);
  assert.equal(isLivingType('kids-room'), true);
  assert.equal(isLivingType('boiler'), false);
  assert.equal(isSummerRoom({ type: 'veranda' }), true);
  const t = scheduleTotals(roomSchedule(p));
  assert.ok(Math.abs(t.living - 9) < 0.01, `жилая ${t.living}`);
  assert.ok(Math.abs(t.summer - 18) < 0.01, `летние ${t.summer}`);
  assert.ok(Math.abs(t.total - 27) < 0.01, `общая ${t.total}`);
  const rows = Object.fromEntries(tepRows(tepReport(p)));
  assert.equal(rows['Жилая площадь'], '9,0 м²');
  assert.equal(rows['Вспомогательная площадь'], '18,0 м²');
});

test('нормы: новые типы не падают; хозяйственные — без замечаний, жилые — свет, санузлы — ширина', () => {
  const p = createProject();
  let x = 0;
  for (const t of ROOM_TYPES) {
    if (t.shaft) continue;
    p.rooms.push(createRoom(t.type, x, 0)); x += t.w + 2000;
  }
  const report = normsReport(p);
  assert.ok(report);
  const level = p.levels[0];
  const kinds = (type) => roomChecks(p, p.rooms.find((r) => r.type === type), level).map((c) => c.kind);
  for (const type of ['boiler', 'laundry', 'storage', 'tech', 'workshop', 'pantry', 'sauna', 'vestibule', 'elevator', 'veranda', 'porch', 'carport']) {
    assert.deepEqual(kinds(type), [], `${type}: без замечаний`);
  }
  assert.ok(kinds('kids-room').includes('light') && kinds('kids-room').includes('area'), 'детская — как спальня');
  assert.ok(kinds('kitchen-living').includes('light'), 'кухня-гостиная — свет');
  assert.deepEqual(kinds('guest-wc'), ['width'], 'гостевой санузел — ширина, как санузел');
  assert.deepEqual(kinds('entrance'), ['width'], 'прихожая — ширина 1,4 м');
  assert.equal(needsOwnAccess(p, p.rooms.find((r) => r.type === 'boiler')), false);
});

test('IFC: категория и тип в IfcSpace; гараж и навес — PARKING, открытые — EXTERNAL', () => {
  const p = createProject();
  p.rooms.push(createRoom('boiler', 0, 0), createRoom('carport', 3000, 0), createRoom('porch', 7000, 0), createRoom('living', 0, 4000));
  const { text, counts } = buildIfc(p, { timestamp: new Date('2026-11-07T00:00:00Z') });
  assert.equal(counts.spaces, 4);
  const spaces = text.split('\n').filter((l) => l.includes('=IFCSPACE('));
  const of = (name) => spaces.find((l) => l.includes(`'${name}'`));
  assert.match(of('Boiler room'), /\.SPACE\.,\$\);$/);
  assert.match(of('Carport'), /\.PARKING\.,\$\);$/);
  assert.match(of('Porch'), /\.EXTERNAL\.,\$\);$/);
  assert.match(of('Living room'), /\.SPACE\.,\$\);$/);
});

test('JSON: экспорт и файл проекта сохраняют новые типы и категорию', () => {
  const p = createProject();
  p.rooms.push(createRoom('laundry', 0, 0), createRoom('entrance', 2300, 0));
  const ex = buildStructuredExport(p);
  const rooms = ex.levels[0].rooms;
  assert.deepEqual(rooms.map((r) => [r.type, r.category]), [['laundry', 'utility'], ['entrance', 'circulation']]);
  const back = deserializeProject(serializeProject(p));
  assert.deepEqual(back.rooms.map((r) => r.type), ['laundry', 'entrance']);
});

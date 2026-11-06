// Сборка списка замечаний (core/issues.js): группы, цели перехода, действия.
import test from 'node:test';
import assert from 'node:assert/strict';

import { collectIssues, ISSUE_GROUPS, unionRect } from '../core/issues.js';
import { createLevel, createProject, createRoom } from '../core/model.js';
import { normsReport } from '../core/norms.js';
import { buildTemplate } from '../core/templates.js';

const all = (issues) => issues.groups.flatMap((g) => g.items);
const group = (issues, id) => issues.groups.find((g) => g.id === id);

test('перекрытие: в группе «Перекрытия», цель — обе комнаты, «Обрезать», рамка — зона перекрытия', () => {
  const p = createProject('перекрытие');
  const a = createRoom('living', 0, 0, 5000, 4000);
  const b = createRoom('kitchen', 4000, 1000, 3000, 3000);
  p.rooms.push(a, b);
  const issues = collectIssues(p);
  const overlap = group(issues, 'overlap');
  assert.equal(overlap.count, 1);
  const [it] = overlap.items;
  assert.equal(it.severity, 'warn');
  assert.equal(it.levelId, p.activeLevel);
  assert.deepEqual(it.target, { type: 'multi', roomIds: [a.id, b.id], itemIds: [] });
  assert.deepEqual(it.focus, { x: 4000, y: 1000, w: 1000, h: 3000 });
  assert.deepEqual(it.actions.map((x) => [x.kind, x.roomId, x.byId]), [['trim', a.id, b.id]]);
  assert.match(it.actions[0].label, /^Обрезать «/);
});

test('связность: нет входа — замечание без цели с рамкой всего этажа; порядок групп', () => {
  const p = createProject();
  const a = createRoom('living', 0, 0, 5000, 4000);
  const b = createRoom('kitchen', 5000, 0, 3000, 4000);
  p.rooms.push(a, b);
  const issues = collectIssues(p);
  const access = group(issues, 'access');
  const entrance = access.items.find((x) => x.id.endsWith(':entrance'));
  assert.match(entrance.text, /Нет входной двери/);
  assert.equal(entrance.target, null);
  assert.deepEqual(entrance.focus, { x: 0, y: 0, w: 8000, h: 4000 });
  const order = ISSUE_GROUPS.map((g) => g.id);
  const ids = issues.groups.map((g) => g.id);
  assert.deepEqual(ids, order.filter((id) => ids.includes(id)), 'группы в порядке ISSUE_GROUPS');
});

test('нормы и свет: площадь — «Нормы и площади», нет окон — «Свет и окна»; цель — комната', () => {
  const p = createProject();
  const small = createRoom('living', 0, 0, 3000, 3000); // 9 м² < 12 м²
  p.rooms.push(small);
  const issues = collectIssues(p);
  const area = group(issues, 'norms').items.find((x) => /Площадь/.test(x.text));
  assert.ok(area, 'замечание о площади');
  assert.deepEqual(area.target, { type: 'room', id: small.id });
  assert.deepEqual(area.focus, { x: 0, y: 0, w: 3000, h: 3000 });
  assert.equal(area.title, small.name);
  const light = group(issues, 'light').items.find((x) => /Нет окон/.test(x.text));
  assert.ok(light, 'замечание о свете');
  assert.deepEqual(light.target, { type: 'room', id: small.id });
});

test('зазор: в «Стены и др.» с «Пристыковать»; цель — пара комнат', () => {
  const p = createProject();
  const living = createRoom('living', 0, 0, 5000, 4000);
  const bed = createRoom('bedroom', 5300, 0, 3000, 3000);
  p.rooms.push(living, bed);
  const gap = group(collectIssues(p), 'walls').items.find((x) => x.id.startsWith('gap:'));
  assert.ok(gap, 'зазор найден');
  assert.match(gap.text, /Нестандартный зазор 300 мм/);
  assert.deepEqual(gap.target, { type: 'multi', roomIds: [living.id, bed.id], itemIds: [] });
  assert.equal(gap.actions[0].kind, 'dock-gap');
  assert.equal(gap.actions[0].key, gap.gapKey);
});

test('число = предупреждения (справочные строки ✓ не считаются); совпадает с нормами и связностью', () => {
  const p = buildTemplate('two-storey');
  const norms = normsReport(p);
  const issues = collectIssues(p, { norms });
  const warn = all(issues).filter((x) => x.severity === 'warn');
  assert.equal(issues.count, warn.length);
  assert.equal(issues.severity, issues.count ? 'warn' : 'ok');
  const normWarn = warn.filter((x) => !x.id.startsWith('access:') && !x.id.startsWith('gap:'));
  assert.equal(normWarn.length, norms.problems.length + (norms.insolation.ok ? 0 : 1));
  for (const g of issues.groups) assert.equal(g.count, g.items.filter((x) => x.severity === 'warn').length);
  // Инсоляция жилых комнат — справочные строки с переходом к комнате.
  const sun = all(issues).filter((x) => x.id.startsWith('light:sun:'));
  assert.ok(sun.length >= 1);
  for (const s of sun) { assert.equal(s.severity, 'ok'); assert.equal(s.target.type, 'room'); }
});

test('этажи: замечание второго этажа — с его levelId и названием этажа', () => {
  const p = createProject();
  p.rooms.push(createRoom('living', 0, 0, 5000, 4000));
  const l2 = createLevel('2 этаж', 3000, 3000, 'L2');
  p.levels.push(l2);
  l2.rooms.push(createRoom('bedroom', 0, 0, 2000, 2000)); // 4 м² < 8 м², нет лестницы
  const issues = collectIssues(p);
  const upper = all(issues).filter((x) => x.levelId === 'L2' && x.severity === 'warn');
  assert.ok(upper.some((x) => /Нет лестницы/.test(x.text)));
  assert.ok(upper.some((x) => /Площадь/.test(x.text)));
  assert.ok(upper.every((x) => x.levelName === '2 этаж'));
});

test('unionRect: габарит, пустой список — null', () => {
  assert.equal(unionRect([]), null);
  assert.deepEqual(unionRect([{ x: 0, y: 0, w: 10, h: 10 }, null, { x: 20, y: -5, w: 5, h: 5 }]), { x: 0, y: -5, w: 25, h: 15 });
});

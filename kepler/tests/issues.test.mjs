// Сборка списка замечаний (core/issues.js): группы, цели перехода, действия,
// фильтры групп, скрытые замечания, стабильные id и ложные срабатывания.
import test from 'node:test';
import assert from 'node:assert/strict';

import { analyzeErgonomics } from '../core/ergonomics.js';
import { collectIssues, DEFAULT_ISSUE_GROUPS, ISSUE_GROUPS, pairKey, unionRect } from '../core/issues.js';
import { createItem, createLevel, createOpening, createProject, createRoom, normalizeProject } from '../core/model.js';
import { normsReport, roomChecks } from '../core/norms.js';
import { analyzeConnectivity } from '../core/rooms.js';
import { buildTemplate } from '../core/templates.js';
import { deriveWalls, sharedKey } from '../core/walls.js';

const all = (issues) => issues.groups.flatMap((g) => g.items);
const group = (issues, id) => issues.groups.find((g) => g.id === id);
const warns = (issues) => all(issues).filter((x) => x.severity === 'warn');

test('умолчания групп: ВКЛ — геометрия и мебель, остальные выкл; семь групп (эргономика — по режиму)', () => {
  assert.deepEqual(ISSUE_GROUPS.map((g) => g.id), ['access', 'norms', 'light', 'insolation', 'furniture', 'geometry', 'ergo']);
  assert.deepEqual(DEFAULT_ISSUE_GROUPS, ['furniture', 'geometry']);
});

test('перекрытие: в группе «Геометрия», цель — обе комнаты, «Обрезать», рамка — зона перекрытия', () => {
  const p = createProject('перекрытие');
  const a = createRoom('living', 0, 0, 5000, 4000);
  const b = createRoom('kitchen', 4000, 1000, 3000, 3000);
  p.rooms.push(a, b);
  const issues = collectIssues(p);
  const overlap = group(issues, 'geometry').items.find((x) => x.id.startsWith('overlap:'));
  assert.equal(overlap.severity, 'warn');
  assert.equal(overlap.levelId, p.activeLevel);
  assert.equal(overlap.id, `overlap:${p.activeLevel}:${pairKey(a.id, b.id)}`, 'id от пары');
  assert.deepEqual(overlap.target, { type: 'multi', roomIds: [a.id, b.id], itemIds: [] });
  assert.deepEqual(overlap.focus, { x: 4000, y: 1000, w: 1000, h: 3000 });
  assert.deepEqual(overlap.actions.map((x) => [x.kind, x.roomId, x.byId]), [['trim', a.id, b.id]]);
  assert.match(overlap.actions[0].label, /^Обрезать «/);
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

test('нормы и свет: площадь — «Нормы площадей и размеров», нет окон — «Свет и окна»; цель — комната', () => {
  const p = createProject();
  const small = createRoom('living', 0, 0, 3000, 3000); // 9 м² < 12 м²
  p.rooms.push(small);
  const issues = collectIssues(p);
  const area = group(issues, 'norms').items.find((x) => /Площадь/.test(x.text));
  assert.ok(area, 'замечание о площади');
  assert.equal(area.id, `area:${p.activeLevel}:${small.id}`);
  assert.deepEqual(area.target, { type: 'room', id: small.id });
  assert.deepEqual(area.focus, { x: 0, y: 0, w: 3000, h: 3000 });
  assert.equal(area.title, small.name);
  const light = group(issues, 'light').items.find((x) => /Нет окон/.test(x.text));
  assert.ok(light, 'замечание о свете');
  assert.deepEqual(light.target, { type: 'room', id: small.id });
});

test('зазор: в «Геометрии» с «Пристыковать»; цель — пара комнат', () => {
  const p = createProject();
  const living = createRoom('living', 0, 0, 5000, 4000);
  const bed = createRoom('bedroom', 5300, 0, 3000, 3000);
  p.rooms.push(living, bed);
  const gap = group(collectIssues(p), 'geometry').items.find((x) => x.id.startsWith('gap:'));
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
  const warn = warns(issues);
  assert.equal(issues.count, warn.length);
  assert.equal(issues.severity, issues.count ? 'warn' : 'ok');
  const normWarn = warn.filter((x) => !x.id.startsWith('access:') && !x.id.startsWith('gap:'));
  const insWarn = !norms.insolation.ok && norms.insolation.siteKnown ? 1 : 0;
  assert.equal(normWarn.length, norms.problems.length + insWarn);
  for (const g of issues.groups) assert.equal(g.count, g.items.filter((x) => x.severity === 'warn').length);
  assert.equal(issues.summary.reduce((s, g) => s + g.count, 0), issues.count, 'все группы включены — сводка = бейдж');
  // Инсоляция жилых комнат — справочные строки с переходом к комнате.
  const sun = all(issues).filter((x) => x.id.startsWith('insolation:sun:'));
  assert.ok(sun.length >= 1);
  for (const s of sun) { assert.equal(s.severity, 'ok'); assert.equal(s.target.type, 'room'); }
  assert.equal(new Set(all(issues).map((x) => x.id)).size, all(issues).length, 'id уникальны');
});

test('этажи: замечание второго этажа — с его levelId и названием этажа', () => {
  const p = createProject();
  p.rooms.push(createRoom('living', 0, 0, 5000, 4000));
  const l2 = createLevel('2 этаж', 3000, 3000, 'L2');
  p.levels.push(l2);
  l2.rooms.push(createRoom('bedroom', 0, 0, 2000, 2000)); // 4 м² < 8 м², нет лестницы
  const issues = collectIssues(p);
  const upper = warns(issues).filter((x) => x.levelId === 'L2');
  assert.ok(upper.some((x) => /Нет лестницы/.test(x.text)));
  assert.ok(upper.some((x) => /Площадь/.test(x.text)));
  assert.ok(upper.every((x) => x.levelName === '2 этаж'));
});

test('фильтр групп: выключенные не в списке и не в бейдже, но в сводке со своим числом', () => {
  const p = createProject();
  const a = createRoom('living', 0, 0, 3000, 3000); // площадь, свет, нет входа
  const b = createRoom('kitchen', 2000, 1000, 3000, 3000); // перекрытие
  p.rooms.push(a, b);
  const full = collectIssues(p);
  const only = collectIssues(p, { enabled: DEFAULT_ISSUE_GROUPS });
  assert.deepEqual(only.groups.map((g) => g.id), ['geometry']);
  assert.equal(only.count, group(full, 'geometry').count);
  assert.ok(full.count > only.count);
  assert.equal(only.enabledCount, 2);
  assert.equal(only.total, 7);
  const norms = only.summary.find((g) => g.id === 'norms');
  assert.equal(norms.enabled, false);
  assert.equal(norms.count, group(full, 'norms').count, 'выключенная группа — сколько было бы');
  const none = collectIssues(p, { enabled: [] });
  assert.equal(none.count, 0);
  assert.equal(none.severity, 'ok');
  assert.deepEqual(none.groups, []);
});

test('скрытые замечания: не в списке и не в бейдже, в hidden; справочные строки не скрываются', () => {
  const p = createProject();
  const small = createRoom('living', 0, 0, 3000, 3000);
  p.rooms.push(small);
  const before = collectIssues(p);
  const area = all(before).find((x) => x.id.startsWith('area:'));
  const sun = all(before).find((x) => x.id.startsWith('insolation:sun:'));
  p.settings.dismissedIssues = [area.id, sun.id, 'нет-такого'];
  const after = collectIssues(p);
  assert.equal(after.count, before.count - 1);
  assert.ok(!all(after).some((x) => x.id === area.id));
  assert.deepEqual(after.hidden.map((x) => x.id), [area.id], 'скрыто только существующее предупреждение');
  assert.ok(all(after).some((x) => x.id === sun.id), 'справочная строка не скрывается');
  assert.equal(after.summary.find((g) => g.id === 'norms').count, before.summary.find((g) => g.id === 'norms').count - 1);
});

test('стабильные id: не зависят от порядка и от посторонних правок', () => {
  const p = createProject();
  const bed = createRoom('bedroom', 0, 0, 2500, 2500);
  const kit = createRoom('kitchen', 5000, 0, 1500, 3000);
  p.rooms.push(bed, kit);
  p.items.push(createItem('wardrobe', 600, 600, 1000, 600), createItem('nightstand', 700, 700, 500, 400));
  const ids1 = all(collectIssues(p)).map((x) => x.id).sort();
  assert.ok(ids1.some((id) => id.startsWith('furniture:') && id.endsWith([...p.items.map((i) => i.id)].sort().join(','))), 'мебель — по предметам');
  p.rooms.reverse();
  p.rooms.push(createRoom('corridor', 0, 6000, 3000, 1200));
  const ids2 = all(collectIssues(p)).map((x) => x.id);
  for (const id of ids1.filter((x) => !x.startsWith('access:') && !x.startsWith('gap:'))) assert.ok(ids2.includes(id), id);
});

test('свет: окна нужны только жилым и кухне; санузел, гардеробная, холл, коридор, лестница, гараж — без замечаний', () => {
  const p = createProject();
  const need = ['living', 'bedroom', 'master-bedroom', 'kitchen', 'cabinet'];
  const skip = ['bathroom', 'wardrobe-room', 'hall', 'corridor', 'stairs-room', 'garage', 'dining', 'terrace', 'balcony'];
  [...need, ...skip].forEach((t, i) => p.rooms.push(createRoom(t, i * 7000, 0, 5000, 4000)));
  const light = group(collectIssues(p), 'light').items;
  const types = new Set(light.map((x) => p.rooms.find((r) => r.id === x.target.id).type));
  for (const t of need) assert.ok(types.has(t), `нужен свет: ${t}`);
  for (const t of skip) assert.ok(!types.has(t), `без замечания: ${t}`);
});

test('свет: кухня-ниша в открытой планировке с гостиной — окна зоны общие', () => {
  const p = createProject();
  const living = createRoom('living', 0, 0, 5000, 4000);
  const kitchen = createRoom('kitchen', 5100, 0, 2500, 4000); // 10 м², без окон
  p.rooms.push(living, kitchen);
  p.openings.push(createOpening('window', living.id, 2, 1000, 2000), createOpening('window', living.id, 0, 1000, 2000));
  const lightOf = () => roomChecks(p, kitchen, p.levels[0], deriveWalls(p)).find((c) => c.kind === 'light');
  assert.equal(lightOf().ok, false, 'со стеной — своё окно нужно');
  p.wallOverrides[sharedKey(living.id, kitchen.id)] = { hidden: true };
  assert.ok(deriveWalls(p).some((w) => w.kind === 'shared' && w.hidden), 'стена скрыта');
  assert.equal(lightOf().ok, true, '6 м² окон на 30 м² зоны ≥ 1:8');
  assert.match(lightOf().text, /общая зона/);
});

test('ширина санузла: без ванны — 0,8 м, с ванной — 1,5 м; гардеробная и кладовая без порогов', () => {
  const p = createProject();
  const wc = createRoom('bathroom', 0, 0, 1000, 1800);
  const dress = createRoom('wardrobe-room', 3000, 0, 1000, 1000);
  p.rooms.push(wc, dress);
  const widthOf = (room) => roomChecks(p, room, p.levels[0]).find((c) => c.kind === 'width');
  assert.equal(widthOf(wc).ok, true, 'туалет 1,0 м ≥ 0,8 м');
  assert.equal(widthOf(dress), undefined);
  assert.equal(roomChecks(p, dress, p.levels[0]).length, 0);
  p.items.push(createItem('bath', 500, 900, 700, 1700));
  assert.equal(widthOf(wc).ok, false, 'ванная 1,0 м < 1,5 м');
});

test('доступность: терраса, шахта, вложенное, гардеробная у спальни — без «добавьте дверь»', () => {
  const p = createProject();
  const living = createRoom('living', 0, 0, 5000, 4000);
  const bed = createRoom('bedroom', 5100, 0, 4000, 4000);
  const dress = createRoom('wardrobe-room', 9200, 0, 2000, 2000);
  const terrace = createRoom('terrace', 0, 4100, 5000, 2500);
  const nested = createRoom('bathroom', 6000, 2000, 1800, 1800);
  nested.parentId = bed.id;
  p.rooms.push(living, bed, dress, terrace, nested);
  p.openings.push(createOpening('door', living.id, 3, 1500, 900)); // вход
  p.openings.push(createOpening('door', living.id, 1, 1500, 900)); // гостиная → спальня
  const a = analyzeConnectivity(p);
  assert.deepEqual(a.unreachable, [], `недоступны: ${a.unreachable}`);
  for (const id of [dress.id, nested.id]) assert.ok(a.exempt.includes(id) || a.reachable.has(id), id);
  assert.ok(a.reachable.has(terrace.id), 'терраса — улица');
  const access = all(collectIssues(p)).filter((x) => x.group === 'access');
  assert.deepEqual(access.map((x) => x.severity), ['ok']);
});

test('доступность: группа комнат с дверью между собой — одна подсказка к доступной комнате', () => {
  const p = createProject();
  const living = createRoom('living', 0, 0, 5000, 4000);
  const bed = createRoom('bedroom', 5100, 0, 4000, 4000);
  const cab = createRoom('cabinet', 9200, 0, 3000, 4000);
  p.rooms.push(living, bed, cab);
  p.openings.push(createOpening('door', living.id, 3, 1500, 900)); // вход
  p.openings.push(createOpening('door', bed.id, 1, 1500, 900)); // спальня ↔ кабинет
  const access = warns(collectIssues(p)).filter((x) => x.group === 'access');
  assert.equal(access.length, 1, access.map((x) => x.text).join(' / '));
  assert.match(access[0].text, /между «Спальня» и «Гостиная»/);
  assert.equal(access[0].id, `access:${p.activeLevel}:${pairKey(bed.id, living.id)}`);
  assert.doesNotMatch(access[0].text, /Кабинет/, 'дверь спальня–кабинет уже есть');
});

test('инсоляция: без участка — справка, а не замечание; с границей участка — замечание', () => {
  const p = createProject();
  p.rooms.push(createRoom('living', 0, 0, 5000, 4200)); // без окон — норма не выполнена
  p.openings.push(createOpening('door', p.rooms[0].id, 3, 1500, 900));
  const ins = () => all(collectIssues(p)).find((x) => x.id === 'insolation:house');
  assert.equal(ins().severity, 'ok');
  assert.match(ins().text, /участок не задан/);
  p.site.boundary = [{ x: -20000, y: -20000 }, { x: 20000, y: -20000 }, { x: 20000, y: 20000 }, { x: -20000, y: 20000 }];
  assert.equal(ins().severity, 'warn');
  assert.ok(collectIssues(p).summary.find((g) => g.id === 'insolation').count >= 1);
  // Без жилых комнат — строки инсоляции нет вовсе.
  const q = createProject();
  q.rooms.push(createRoom('garage', 0, 0, 3600, 6000));
  assert.equal(all(collectIssues(q)).some((x) => x.group === 'insolation'), false);
});

test('нормализация: dismissedIssues — уникальные строки; пусто/мусор — поля нет', () => {
  const a = normalizeProject({ ...createProject(), settings: { dismissedIssues: ['x', 'x', '', 5, null, 'y'] } });
  assert.deepEqual(a.settings.dismissedIssues, ['x', 'y']);
  const b = normalizeProject({ ...createProject(), settings: { dismissedIssues: 'x' } });
  assert.equal('dismissedIssues' in b.settings, false);
  const c = normalizeProject({ ...createProject(), settings: { dismissedIssues: [] } });
  assert.equal('dismissedIssues' in c.settings, false);
  const d = normalizeProject(JSON.parse(JSON.stringify(a)));
  assert.deepEqual(d.settings.dismissedIssues, ['x', 'y'], 'переживает сохранение');
});

test('unionRect: габарит, пустой список — null', () => {
  assert.equal(unionRect([]), null);
  assert.deepEqual(unionRect([{ x: 0, y: 0, w: 10, h: 10 }, null, { x: 20, y: -5, w: 5, h: 5 }]), { x: 0, y: -5, w: 25, h: 15 });
});

test('эргономика: находки режима — группа «Эргономика», переход к предмету', () => {
  const p = createProject();
  const r = createRoom('bedroom', 0, 0, 2100, 4000);
  p.rooms.push(r);
  const bed = createItem('bed-double', 800, 1000, 1600, 2000);
  p.items.push(bed);
  const ergo = analyzeErgonomics(p, deriveWalls(p)).findings;
  assert.ok(ergo.length >= 1);
  const off = collectIssues(p, { enabled: DEFAULT_ISSUE_GROUPS, ergo });
  assert.equal(off.groups.find((g) => g.id === 'ergo'), undefined, 'группа выключена — записей нет');
  const on = collectIssues(p, { enabled: [...DEFAULT_ISSUE_GROUPS, 'ergo'], ergo });
  const g = on.groups.find((x) => x.id === 'ergo');
  assert.equal(g.count, ergo.length);
  const e = g.items.find((x) => x.target?.id === bed.id);
  assert.equal(e.target.type, 'item');
  assert.equal(e.mark, '⛔');
  assert.ok(e.focus && e.focus.w > 0);
});

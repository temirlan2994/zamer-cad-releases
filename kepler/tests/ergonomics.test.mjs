// Эргономика мебели (core/ergonomics.js): зоны пользования, зазоры,
// двери, окна, доступность, рабочий треугольник, повороты, составная мебель.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createRoom, createOpening, createItem } from '../core/model.js';
import { deriveWalls } from '../core/walls.js';
import { withDefaultComp } from '../core/composite.js';
import {
  analyzeErgonomics, analyzeRoomErgonomics, ergoContext, ERGO_NORMS, ergoRulesTable, suggestErgoFix,
} from '../core/ergonomics.js';

// Комната w×h с дверью внизу (сторона 2) у левого края, открывается внутрь.
function room(w = 4000, h = 4000, type = 'bedroom', door = { side: 2, offset: 600 }) {
  const p = createProject();
  const r = createRoom(type, 0, 0, w, h);
  p.rooms.push(r);
  if (door) p.openings.push(createOpening('door', r.id, door.side, door.offset, 800));
  return { p, r };
}
const run = (p, r) => analyzeRoomErgonomics(p, r, deriveWalls(p));
const bad = (res, pred = () => true) => res.findings.filter((f) => f.severity !== 'ok' && pred(f));
const add = (p, ...items) => { p.items.push(...items); return items; };

test('кровать у стены: проход 500 — ошибка, 750 — норма', () => {
  const a = room(1600 + 500, 4000);
  const [bed] = add(a.p, createItem('bed-double', 800, 1000, 1600, 2000));
  const res = run(a.p, a.r);
  const side = bad(res, (f) => f.group === 'bed');
  assert.equal(side.length, 1, JSON.stringify(res.findings.map((f) => f.text)));
  assert.equal(side[0].severity, 'error');
  assert.equal(side[0].gap, 500);
  assert.equal(side[0].need, ERGO_NORMS.bedSide.need);
  assert.match(side[0].text, /справа 500 мм до стены/);
  assert.deepEqual(side[0].itemIds, [bed.id]);
  assert.equal(side[0].label, '500 < 700');
  assert.ok(side[0].zone.length === 4 && side[0].band && side[0].dim, 'зона, полоса и размер');

  const b = room(1600 + 750, 4000);
  add(b.p, createItem('bed-double', 800, 1000, 1600, 2000));
  assert.deepEqual(bad(run(b.p, b.r)).map((f) => f.text), []);
  // Оба бока вплотную — к кровати не подойти.
  const c = room(1600, 4000, 'bedroom', { side: 2, offset: 800 });
  add(c.p, createItem('bed-double', 800, 1000, 1600, 2000));
  assert.ok(bad(run(c.p, c.r), (f) => f.rule === 'bed').length === 1);
});

test('шкаф: перед фасадом 500 — ошибка, 900 — норма; лицом к стене — меряется свободная сторона; повороты 90° и 45°', () => {
  const a = room();
  const [wr, box] = add(a.p, createItem('wardrobe', 2000, 300, 1800, 600), createItem('box', 2000, 1600, 1000, 1000));
  const f = bad(run(a.p, a.r), (x) => x.group === 'storage');
  assert.equal(f.length, 1);
  assert.equal(f[0].severity, 'error');
  assert.equal(f[0].gap, 500);
  assert.deepEqual(f[0].itemIds, [wr.id, box.id]);
  assert.match(f[0].text, /перед фасадом 500 мм до «Прямоугольный блок»/);

  const b = room();
  add(b.p, createItem('wardrobe', 2000, 300, 1800, 600), createItem('box', 2000, 2000, 1000, 1000));
  assert.deepEqual(bad(run(b.p, b.r), (x) => x.group === 'storage'), []);

  // Шкаф «лицом к стене» (на плане не видно) — меряется свободная сторона.
  const w2 = room();
  add(w2.p, createItem('wardrobe', 2000, 300, 1800, 600, 180), createItem('box', 2000, 1600, 1000, 1000));
  const back = bad(run(w2.p, w2.r), (x) => x.group === 'storage');
  assert.equal(back.length, 1);
  assert.equal(back[0].gap, 500);

  // 90°: шкаф у правой стены смотрит влево (лицо — локальная +Y).
  const c = room();
  add(c.p, createItem('wardrobe', 3700, 2000, 1800, 600, 90), createItem('box', 2400, 2000, 1000, 1000));
  const r90 = bad(run(c.p, c.r), (x) => x.group === 'storage');
  assert.equal(r90.length, 1);
  assert.equal(r90[0].gap, 500);
  assert.ok(r90[0].dim.b.x < r90[0].dim.a.x, 'размер идёт влево от шкафа');

  // 45°: блок вдоль нормали лица письменного стола на 500 мм (шкаф стоял бы
  // лицом к свободной стороне — у него лицо не видно на плане).
  const d = room(6000, 6000);
  const n = { x: -Math.SQRT1_2, y: Math.SQRT1_2 };
  const at = (k) => ({ x: 3000 + n.x * k, y: 3000 + n.y * k });
  const bp = at(300 + 500 + 300);
  add(d.p, createItem('desk', 3000, 3000, 1200, 600, 45), createItem('box', bp.x, bp.y, 600, 600, 45));
  const r45 = bad(run(d.p, d.r), (x) => x.rule === 'zone');
  assert.equal(r45.length, 1);
  assert.ok(Math.abs(r45[0].gap - 500) <= 1, `зазор ${r45[0].gap}`);
});

test('обеденный стол у стены 500 — ошибка; стулья и ковёр не препятствие; «Исправить» отодвигает', () => {
  const a = room(5000, 5000, 'kitchen-dining');
  const [table] = add(a.p, createItem('dining-table', 2500, 950, 1600, 900));
  add(a.p, createItem('chair', 2500, 1650, 450, 450), createItem('rug', 2500, 1200, 2000, 1400));
  const res = run(a.p, a.r);
  const f = bad(res, (x) => x.itemIds.includes(table.id) && x.rule === 'zone');
  assert.equal(f.length, 1, JSON.stringify(res.findings.map((x) => x.text)));
  assert.equal(f[0].severity, 'error');
  assert.equal(f[0].gap, 500);
  assert.match(f[0].text, /за стулом 500 мм до стены/);
  const fix = suggestErgoFix(a.p, deriveWalls(a.p), f[0]);
  assert.deepEqual([fix.dx, fix.dy], [0, 300]);
  table.y += fix.dy;
  assert.deepEqual(bad(run(a.p, a.r), (x) => x.itemIds.includes(table.id)), []);
  // Стол со стульями (comp): стулья не мерятся как препятствие.
  const b = room(5000, 5000, 'kitchen-dining');
  add(b.p, withDefaultComp(createItem('dining-table', 2500, 2500, 1600, 900)));
  assert.deepEqual(bad(run(b.p, b.r)).map((x) => x.text), []);
});

test('кухня: ряды через 800 — «тесно», 1100 — норма; одна находка на пару', () => {
  const rows = (gap) => {
    const a = room(4000, 3500, 'kitchen', { side: 3, offset: 2800 });
    add(a.p, createItem('kitchen-row', 2400, 300, 2400, 600), createItem('kitchen-row', 2400, 600 + gap + 300, 2400, 600, 180));
    return bad(run(a.p, a.r), (x) => x.group === 'kitchen' && x.rule === 'zone');
  };
  const narrow = rows(800);
  assert.equal(narrow.length, 1);
  assert.equal(narrow[0].severity, 'warn');
  assert.equal(narrow[0].gap, 800);
  assert.deepEqual(rows(1100), []);
});

test('санузел: перед унитазом 400 — ошибка; унитаз вплотную боком — ошибка', () => {
  const a = room(1500, 2500, 'bathroom', { side: 2, offset: 1000 });
  const [wc] = add(a.p, createItem('toilet', 750, 325, 400, 650), createItem('box', 750, 650 + 400 + 300, 600, 600));
  const front = bad(run(a.p, a.r), (x) => x.itemIds[0] === wc.id && x.fix?.side === 'front');
  assert.equal(front.length, 1);
  assert.equal(front[0].severity, 'error');
  assert.equal(front[0].gap, 400);
  const b = room(1500, 2500, 'bathroom', { side: 2, offset: 1000 });
  const [wc2] = add(b.p, createItem('toilet', 200, 325, 400, 650));
  const side = bad(run(b.p, b.r), (x) => x.itemIds[0] === wc2.id && x.group === 'bath');
  assert.ok(side.some((x) => x.severity === 'error' && /сбоку слева 0 мм/.test(x.text)), side.map((x) => x.text).join(' | '));
});

test('дверь: диван в зоне открывания — ошибка; перед дверью свободно — нет', () => {
  const a = room(4000, 4000, 'living', { side: 2, offset: 700 });
  const [sofa] = add(a.p, createItem('sofa', 1300, 3500, 2200, 950, 180));
  const res = run(a.p, a.r);
  const door = bad(res, (x) => x.rule === 'door');
  assert.equal(door.length, 1);
  assert.equal(door[0].severity, 'error');
  assert.deepEqual(door[0].itemIds, [sofa.id]);
  assert.ok(door[0].sector && door[0].zone.length > 5, 'сектор открывания');
  // Свободная дверь — зона открывания в «нормальных».
  const b = room(4000, 4000, 'living', { side: 2, offset: 700 });
  add(b.p, createItem('sofa', 2500, 600, 2200, 950));
  const ok = run(b.p, b.r);
  assert.deepEqual(bad(ok, (x) => x.group === 'doors'), []);
  assert.ok(ok.okZones.some((z) => z.rule === 'door'));
});

test('окно: высокий шкаф перед окном — замечание, комод ниже подоконника — нет', () => {
  const a = room();
  a.p.openings.push(createOpening('window', a.r.id, 0, 2000, 1200));
  const [wr] = add(a.p, createItem('wardrobe', 2000, 300, 1800, 600));
  const w = bad(run(a.p, a.r), (x) => x.rule === 'window');
  assert.equal(w.length, 1);
  assert.deepEqual(w[0].itemIds, [wr.id]);
  const b = room();
  b.p.openings.push(createOpening('window', b.r.id, 0, 2000, 1200));
  add(b.p, createItem('dresser', 2000, 225, 1000, 450));
  assert.deepEqual(bad(run(b.p, b.r), (x) => x.rule === 'window'), []);
});

test('недоступный предмет — ошибка «⛔»', () => {
  const a = room(5000, 4000, 'living', { side: 2, offset: 700 });
  const [bed] = add(a.p,
    createItem('bed-double', 4100, 1000, 1600, 2000),
    createItem('wardrobe', 2800, 1000, 600, 2000),
    createItem('wardrobe', 3700, 2600, 2400, 600));
  const reach = bad(run(a.p, a.r), (x) => x.rule === 'reach');
  assert.ok(reach.some((x) => x.itemIds[0] === bed.id && x.severity === 'error' && x.label === '⛔'), reach.map((x) => x.text).join(' | '));
});

test('рабочий треугольник: 1,6 + 1,9 + 1,9 м — норма; мойка у плиты — замечание', () => {
  const tri = (hobX) => {
    const a = room(5000, 4000, 'kitchen', { side: 3, offset: 3200 });
    add(a.p, createItem('sink', 1000, 250, 600, 500), createItem('stove', hobX, 300, 600, 600), createItem('fridge', 1800, 2000, 650, 650));
    return run(a.p, a.r);
  };
  const ok = tri(2600);
  assert.equal(ok.triangle.severity, 'ok');
  assert.deepEqual(ok.triangle.sides.map((s) => Math.round(s / 100)), [16, 19, 19]);
  assert.deepEqual(bad(ok, (x) => x.rule === 'triangle'), []);
  const near = tri(1500);
  const f = bad(near, (x) => x.rule === 'triangle');
  assert.equal(f.length, 1);
  assert.equal(f[0].severity, 'warn');
  assert.match(f[0].text, /мойка–плита 0,5 м < 1,2/);
});

test('составной диван: зона по сиденьям, проход перед ним 500 — ошибка', () => {
  const a = room(5000, 5000, 'living');
  const sofa = withDefaultComp(createItem('sofa', 2500, 1000, 2200, 950));
  add(a.p, sofa);
  const front = 1000 + sofa.h / 2;
  add(a.p, createItem('box', 2500, front + 500 + 500, 3000, 1000));
  const f = bad(run(a.p, a.r), (x) => x.itemIds[0] === sofa.id && x.rule === 'zone');
  assert.equal(f.length, 1, JSON.stringify(f.map((x) => x.text)));
  assert.equal(f[0].severity, 'error');
  assert.ok(Math.abs(f[0].gap - 500) <= 1);
  // Журнальный столик в 400 мм — проход не нарушает, расстояние в норме.
  const b = room(5000, 5000, 'living');
  const s2 = withDefaultComp(createItem('sofa', 2500, 1000, 2200, 950));
  add(b.p, s2, createItem('coffee-table', 2500, 1000 + s2.h / 2 + 400 + 300, 900, 600));
  assert.deepEqual(bad(run(b.p, b.r)).map((x) => x.text), []);
});

test('пустая комната — пусто; анализ чистый и детерминированный', () => {
  const e = room();
  const empty = run(e.p, e.r);
  assert.deepEqual(empty.findings, []);
  assert.equal(empty.heat, null);
  const a = room();
  add(a.p, createItem('bed-double', 800, 1000, 1600, 2000), createItem('wardrobe', 3000, 300, 1800, 600), createItem('box', 3000, 1300, 800, 800));
  const before = JSON.stringify(a.p);
  const walls = deriveWalls(a.p);
  const r1 = analyzeErgonomics(a.p, walls, { heat: true });
  const r2 = analyzeErgonomics(a.p, walls, { heat: true });
  assert.equal(JSON.stringify(a.p), before, 'проект не меняется');
  const strip = (r) => JSON.stringify(r.findings) + JSON.stringify(r.rooms.map((x) => [...(x.heat?.cls || [])]));
  assert.equal(strip(r1), strip(r2));
  assert.ok(r1.counts.error + r1.counts.warn === r1.findings.length);
  // Фильтр групп.
  assert.ok(analyzeErgonomics(a.p, walls, { groups: ['bed'] }).findings.every((f) => f.group === 'bed'));
  // Тепловая карта: классы 1–3 у свободных клеток.
  const heat = r1.rooms[0].heat;
  assert.ok(heat.cls.includes(3) && heat.cls.length === heat.cols * heat.rows);
  assert.ok(ergoRulesTable().length > 10);
});

test('контекст эргономики учитывает только требуемые створки двустворчатой двери', () => {
  const p = createProject();
  const r = createRoom('hall', 0, 0, 4000, 4000);
  const door = createOpening('door', r.id, 0, 2000, 1800);
  door.type = 'double';
  p.rooms.push(r);
  p.openings.push(door);
  const walls = deriveWalls(p);

  assert.equal(ergoContext(p, walls).doors[0].leaves.length, 2);
  door.requiredLeafIndices = [0];
  assert.equal(ergoContext(p, walls).doors[0].leaves.length, 1);
});

test('производительность: 14 комнат с мебелью < 150 мс, одна комната < 30 мс', () => {
  const p = createProject();
  for (let k = 0; k < 14; k += 1) {
    const x = (k % 5) * 5200; const y = Math.floor(k / 5) * 5200;
    const r = createRoom('bedroom', x, y, 5000, 5000);
    p.rooms.push(r);
    p.openings.push(createOpening('door', r.id, 2, 700, 800));
    p.items.push(
      createItem('bed-double', x + 2500, y + 1000, 1600, 2000), createItem('nightstand', x + 1450, y + 200, 450, 400),
      createItem('wardrobe', x + 4700, y + 2500, 1800, 600, 90), createItem('dresser', x + 2500, y + 4775, 1000, 450, 180),
      createItem('desk', x + 300 + 300, y + 3000, 1200, 600, 270), createItem('office-chair', x + 1100, y + 3000, 600, 600),
      createItem('armchair', x + 3800, y + 3800, 750, 800, 135), createItem('rug', x + 2500, y + 2600, 2000, 1400),
    );
  }
  const walls = deriveWalls(p);
  const ctx = ergoContext(p, walls);
  analyzeErgonomics(p, walls, { ctx }); // прогрев
  let t = performance.now();
  const all = analyzeErgonomics(p, walls, { ctx });
  const tAll = performance.now() - t;
  t = performance.now();
  analyzeRoomErgonomics(p, p.rooms[3], walls, ctx);
  const tOne = performance.now() - t;
  assert.equal(all.rooms.length, 14);
  assert.ok(tAll < 150, `все комнаты ${tAll.toFixed(1)} мс`);
  assert.ok(tOne < 30, `одна комната ${tOne.toFixed(1)} мс`);
});

test('кухня-конструктор Г: угол не нарушение, проход перед стороной 800 — «тесно», треугольник по элементам', () => {
  const a = room(4000, 4000, 'kitchen', { side: 2, offset: 3000 });
  const k = withDefaultComp(createItem('kitchen-corner', 0, 0, 2400, 1800));
  k.x = k.w / 2; k.y = k.h / 2;
  add(a.p, k);
  assert.deepEqual(bad(run(a.p, a.r)).map((f) => f.text), [], 'угловая кухня в углу — без замечаний');
  // Блок напротив основной стороны в 800 мм.
  const b = room(4000, 4000, 'kitchen', { side: 2, offset: 3000 });
  const k2 = withDefaultComp(createItem('kitchen-corner', 0, 0, 2400, 1800));
  k2.x = k2.w / 2; k2.y = k2.h / 2;
  const depth = k2.comp.depth || 600;
  add(b.p, k2, createItem('box', 2600, depth + 800 + 300, 600, 600), createItem('fridge', 3600, 325, 650, 650));
  const res = run(b.p, b.r);
  const f = bad(res, (x) => x.itemIds[0] === k2.id && x.rule === 'zone');
  assert.ok(f.some((x) => x.severity === 'warn' && x.gap === 800), f.map((x) => x.text).join(' | '));
  assert.ok(res.triangle, 'мойка и плита — элементы кухни, холодильник — отдельный предмет');
  assert.equal(res.triangle.points.length, 3);
});

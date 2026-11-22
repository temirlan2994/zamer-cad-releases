// Дорожка: соединение в углах (срез, встык, угловая плита, скругление),
// укладка плит (естественная/строгая), настил, «Разорвать» и учёт новых
// плит/досок в ведомости, DXF, 3D и хранении.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createLandscapeObject, insertVertex, lineLayout, normalizeLandscape, objectAreaM2, objectOutline, pathBoards,
  polygonArea, removeVertex, seededRandom, steppingSlabs,
} from '../core/landscape.js';
import { canExplode, explodePath } from '../core/landscape-tools.js';
import { landscapeDxfEntities, landscapeSchedule } from '../core/landscape-report.js';
import { landscapeFaces } from '../core/mesh3d-landscape.js';
import { MITER_LIMIT, areaOf, pathLayout, rectCorners, rectsOverlap } from '../core/path-geometry.js';
import { buildStructuredExport } from '../core/export.js';
import { createProject, deserializeProject, serializeProject } from '../core/model.js';
import { segmentsIntersect } from '../core/zamer/geometry.js';

const CORNERS = ['miter', 'butt', 'slab', 'round'];
const SHAPES = {
  'поворот 90°': [{ x: 0, y: 0 }, { x: 6000, y: 0 }, { x: 6000, y: 5000 }],
  'острый угол': [{ x: 0, y: 0 }, { x: 6000, y: 0 }, { x: 1500, y: 3000 }],
  'зигзаг': [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 6000, y: 2500 }, { x: 6000, y: 6000 }, { x: 2000, y: 7000 }],
  'поворот влево': [{ x: 0, y: 0 }, { x: 5000, y: 0 }, { x: 5000, y: -4000 }, { x: 9000, y: -4000 }],
};
const path = (points, opts = {}) => createLandscapeObject('path', 0, 0, { id: 'ls-test', points, width: 900, variant: 'stepping', ...opts });
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const unitV = (a, b) => {
  const l = Math.hypot(b.x - a.x, b.y - a.y);
  return { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
};

// Простой многоугольник: несмежные рёбра не пересекаются.
function selfIntersects(poly) {
  const n = poly.length;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 2; j < n; j += 1) {
      if (i === 0 && j === n - 1) continue;
      const a = poly[i]; const b = poly[(i + 1) % n]; const c = poly[j]; const d = poly[(j + 1) % n];
      if (Math.hypot(b.x - c.x, b.y - c.y) < 1 || Math.hypot(a.x - d.x, a.y - d.y) < 1) continue;
      if (segmentsIntersect(a, b, c, d)) return true;
    }
  }
  return false;
}

test('плиты-ступени: ни одна плита не пересекает другую — 4 типа угла × 2 укладки × формы', () => {
  for (const [name, pts] of Object.entries(SHAPES)) {
    for (const corner of CORNERS) {
      for (const laying of ['natural', 'strict']) {
        const slabs = steppingSlabs(path(pts, { corner, laying }));
        assert.ok(slabs.length >= 6, `${name}/${corner}/${laying}: плиты есть`);
        for (let i = 0; i < slabs.length; i += 1) {
          for (let j = i + 1; j < slabs.length; j += 1) {
            assert.ok(!rectsOverlap(slabs[i], slabs[j]), `${name}/${corner}/${laying}: плиты ${i} и ${j} пересекаются`);
          }
        }
      }
    }
  }
  // Сглаженная дорожка с крутым изгибом — тоже без наложений.
  const smooth = steppingSlabs(path([{ x: 0, y: 0 }, { x: 3000, y: 0 }, { x: 3000, y: 2500 }, { x: 0, y: 2600 }], { smooth: true }));
  for (let i = 0; i < smooth.length; i += 1) for (let j = i + 1; j < smooth.length; j += 1) assert.ok(!rectsOverlap(smooth[i], smooth[j]));
});

test('углы: угловая плита — квадрат в изломе, встык — первый участок до кромки второго, скругление — по дуге', () => {
  const L = SHAPES['поворот 90°'];
  const pad = steppingSlabs(path(L, { corner: 'slab', laying: 'strict' })).find((s) => s.corner);
  assert.ok(pad, 'угловая плита есть');
  assert.equal(pad.along, pad.across, 'квадратная');
  assert.ok(near(pad.x, 6000, 1) && near(pad.y, 0, 1), 'в изломе');
  // Встык: последняя плита первого участка заходит за ось второго (покрывает угол).
  const butt = steppingSlabs(path(L, { corner: 'butt' }));
  assert.ok(butt.some((s) => s.run === 0 && s.x + s.along / 2 > 6000), 'первый участок заходит в угол');
  const second = butt.filter((s) => s.run === 1);
  assert.ok(Math.min(...second.map((s) => s.y - s.along / 2)) >= 450, 'второй — от кромки первого');
  // Срез: плиты обоих участков по свою сторону биссектрисы.
  for (const s of steppingSlabs(path(L, { corner: 'miter' }))) {
    for (const c of rectCorners(s)) {
      const side = (c.x - 6000) + c.y; // биссектриса x − 6000 = −y через (6000, 0)
      if (s.run === 0) assert.ok(side <= 1, 'первый участок — до среза'); else assert.ok(side >= -1, 'второй — после');
    }
  }
  // Скругление: на дуге плиты повёрнуты между 0° и 90°.
  const arc = steppingSlabs(path(L, { corner: 'round' })).filter((s) => s.run === 1);
  assert.ok(arc.length >= 1);
  for (const s of arc) assert.ok(s.angle > 0.1 && s.angle < Math.PI / 2 - 0.1);
});

test('строгая укладка: одинаковые плиты, постоянный шаг, без поворота относительно участка', () => {
  const o = path(SHAPES['зигзаг'], { laying: 'strict', corner: 'miter', slabL: 400, slabW: 800, gap: 150, align: 'left' });
  const slabs = steppingSlabs(o);
  const L = lineLayout(o);
  for (const [k, run] of L.runs.entries()) {
    const list = slabs.filter((s) => s.run === k);
    const ang = Math.atan2(run.u0.y, run.u0.x);
    for (const s of list) {
      assert.equal(s.along, 400);
      assert.equal(s.across, 800);
      assert.ok(near(s.angle, ang, 1e-9), 'поворот = направлению участка');
      // Выравнивание по левому краю (−n): смещение (900 − 800) / 2.
      const d = (s.x - run.pts[0].x) * -run.u0.y + (s.y - run.pts[0].y) * run.u0.x;
      assert.ok(near(d, -50, 1e-6));
    }
    for (let i = 1; i < list.length; i += 1) assert.ok(near(Math.hypot(list[i].x - list[i - 1].x, list[i].y - list[i - 1].y), 550, 1e-6), 'шаг = плита + зазор');
  }
  // Тон: одинаковый, или шахматный по флажку.
  assert.ok(slabs.every((s) => s.ci === 0));
  const chk = steppingSlabs(path(SHAPES['зигзаг'], { laying: 'strict', checker: true })).filter((s) => !s.corner);
  assert.ok(chk.some((s) => s.ci === 1) && chk.some((s) => s.ci === 0));
  // Шаг от начала сдвигает укладку первого участка.
  const a = steppingSlabs(path([{ x: 0, y: 0 }, { x: 8000, y: 0 }], { laying: 'strict' }));
  const b = steppingSlabs(path([{ x: 0, y: 0 }, { x: 8000, y: 0 }], { laying: 'strict', offset: 100 }));
  assert.ok(near(b[0].x - a[0].x, 100, 1e-6));
});

test('старые проекты без новых полей: прямая дорожка — те же плиты, что раньше', () => {
  // Прежний алгоритм (до углов и укладки) — для сравнения.
  const old = (o) => {
    const [p0, p1] = o.points;
    const total = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    const angle = Math.atan2(p1.y - p0.y, p1.x - p0.x);
    const width = o.width;
    const along = Math.round(Math.min(650, Math.max(300, width * 0.45)));
    const gap = Math.round(Math.min(300, Math.max(120, width * 0.18)));
    const step = along + gap;
    const count = Math.max(1, Math.floor((total + gap) / step));
    const lead = (total - (count * step - gap)) / 2;
    const rand = seededRandom(o.id);
    const out = [];
    for (let i = 0; i < count; i += 1) {
      const s = lead + i * step + along / 2;
      const x = p0.x + Math.cos(angle) * s; const y = p0.y + Math.sin(angle) * s;
      const jitter = (rand() - 0.5) * 0.08;
      const shift = (rand() - 0.5) * width * 0.08;
      out.push({ x: x - Math.sin(angle) * shift, y: y + Math.cos(angle) * shift, angle: angle + jitter, along, across: Math.round(width * (0.9 + rand() * 0.1)), tone: rand() });
    }
    return out;
  };
  const o = createLandscapeObject('path', 0, 0, { id: 'ls-old', points: [{ x: 100, y: 200 }, { x: 9100, y: 3200 }], width: 1000, variant: 'stepping' });
  const now = steppingSlabs(o);
  const was = old(o);
  assert.equal(now.length, was.length);
  now.forEach((s, i) => {
    for (const k of ['x', 'y', 'angle', 'across', 'tone']) assert.ok(near(s[k], was[i][k], 1e-6), `${k} плиты ${i}`);
    assert.equal(s.along, was[i].along);
  });
  // Контур прямой дорожки — прямоугольник длина × ширина.
  assert.ok(near(polygonArea(objectOutline(o)), Math.hypot(9000, 3000) * 1000, 1));
});

test('контур полосы: куски без дыр и наложений, без самопересечений, срез ограничен', () => {
  for (const [name, pts] of Object.entries(SHAPES)) {
    for (const corner of CORNERS) {
      const L = pathLayout(pts, { width: 900, corners: pts.map((_, i) => (i > 0 && i < pts.length - 1 ? corner : null)) });
      const sum = L.pieces.reduce((s, p) => s + areaOf(p.poly), 0);
      assert.ok(near(sum, areaOf(L.outline), 1), `${name}/${corner}: сумма кусков = площади контура`);
      if (name !== 'острый угол') assert.ok(!selfIntersects(L.outline), `${name}/${corner}: контур без самопересечений`);
      // Внешний угол: вершина среза не дальше MITER_LIMIT полуширин от излома
      // (дальше может быть только внутренняя точка — по направлению поворота).
      for (let i = 1; corner !== 'round' && i < pts.length - 1; i += 1) {
        const V = pts[i];
        const u1 = unitV(pts[i - 1], V); const u2 = unitV(V, pts[i + 1]);
        const turn = { x: u2.x - u1.x, y: u2.y - u1.y };
        for (const p of L.outline) {
          const d = Math.hypot(p.x - V.x, p.y - V.y);
          const outer = (p.x - V.x) * turn.x + (p.y - V.y) * turn.y < 0;
          if (outer && d < 3000) assert.ok(d <= 450 * MITER_LIMIT + 1, `${name}/${corner}: срез ограничен (${Math.round(d)})`);
        }
      }
    }
  }
  // Срез, встык и угловая плита дают один контур (отличаются швы).
  const pts = SHAPES['поворот 90°'];
  const areas = ['miter', 'butt', 'slab'].map((c) => areaOf(pathLayout(pts, { width: 900, corners: [null, c, null] }).outline));
  assert.ok(areas.every((a) => near(a, 9900000, 1)), 'L × ширина');
  const round = pathLayout(pts, { width: 900, corners: [null, 'round', null] });
  assert.ok(areaOf(round.outline) < 9900000 && round.runs.some((r) => r.kind === 'arc'));
  // Встык: шов — поперёк второго участка по кромке первого.
  const butt = pathLayout(pts, { width: 900, corners: [null, 'butt', null] });
  assert.ok(butt.runs[1].capStart.every((p) => near(p.y, 450, 1e-6)));
});

test('настил: прямая и со сдвигом стыков, подрезка у стыков, площадь', () => {
  const pts = SHAPES['поворот 90°'];
  const straight = pathBoards(path(pts, { variant: 'deck', corner: 'miter' }));
  assert.ok(straight.some((b) => b.poly), 'у среза доски подрезаны');
  assert.ok(straight.filter((b) => !b.poly).every((b) => b.across === 900 && b.along === 145));
  const stagger = pathBoards(path(pts, { variant: 'deck', deck: 'stagger', boardL: 500, laying: 'strict' }));
  assert.ok(stagger.length > straight.length * 1.5, 'со сдвигом — доски кусками');
  const full = stagger.filter((b) => !b.poly);
  assert.ok(full.every((b) => b.ci === 0), 'строгая — одинаковый тон');
  for (let i = 0; i < full.length; i += 1) for (let j = i + 1; j < full.length; j += 1) assert.ok(!rectsOverlap(full[i], full[j]));
  // Площадь досок ≈ площади дорожки за вычетом швов.
  const o = path(pts, { variant: 'deck', corner: 'slab' });
  const boards = pathBoards(o).reduce((s, b) => s + (b.poly ? areaOf(b.poly) : b.along * b.across), 0) / 1e6;
  assert.ok(boards < objectAreaM2(o) && boards > objectAreaM2(o) * 0.93);
});

test('«Разорвать»: плиты — отдельные объекты на тех же местах; площадь сохраняется; одиночный участок тоже', () => {
  for (const corner of CORNERS) {
    const o = path(SHAPES['поворот 90°'], { corner, color: '#a0a0a0' });
    const slabs = steppingSlabs(o);
    const res = explodePath(o);
    assert.equal(res.kind, 'slab');
    assert.equal(res.objects.length, slabs.length, `${corner}: число плит`);
    res.objects.forEach((s, i) => {
      assert.equal(s.kind, 'slab');
      assert.ok(near(s.x, slabs[i].x, 1) && near(s.y, slabs[i].y, 1), 'на том же месте');
      assert.ok(near(((s.rotation * Math.PI) / 180 - slabs[i].angle + 4 * Math.PI) % (2 * Math.PI), 0, 1e-3) || near(((s.rotation * Math.PI) / 180 - slabs[i].angle + 4 * Math.PI) % (2 * Math.PI), 2 * Math.PI, 1e-3));
      assert.ok(/^#[0-9a-f]{6}$/i.test(s.color), 'тон — свой цвет');
    });
    const before = objectAreaM2(o);
    const after = res.objects.reduce((s, x) => s + objectAreaM2(x), 0);
    assert.ok(near(before, after, 0.005), `${corner}: площадь плит ${before} → ${after}`);
  }
  // Брусчатка, бетон, гравий → площадные контуры по участкам и углам; площадь та же.
  for (const [variant, kind] of [['pavers', 'paving-area'], ['concrete', 'paving-area'], ['gravel', 'gravel-area']]) {
    for (const corner of CORNERS) {
      const o = path(SHAPES['поворот 90°'], { variant, corner });
      const res = explodePath(o);
      assert.equal(res.kind, 'area');
      assert.ok(res.objects.every((x) => x.kind === kind));
      assert.equal(res.objects.length, corner === 'miter' || corner === 'butt' ? 2 : 3);
      const after = res.objects.reduce((s, x) => s + objectAreaM2(x), 0);
      assert.ok(near(objectAreaM2(o), after, 0.01), `${variant}/${corner}`);
    }
  }
  // Настил → доски (подрезанные — куски настила).
  const deck = explodePath(path(SHAPES['поворот 90°'], { variant: 'deck' }));
  assert.equal(deck.kind, 'board');
  assert.ok(deck.objects.filter((x) => x.kind === 'board').length > 30);
  assert.ok(deck.objects.every((x) => x.kind === 'board' || x.kind === 'deck-area'));
  // Один участок.
  const one = explodePath(path([{ x: 0, y: 0 }, { x: 3000, y: 0 }]));
  assert.ok(one.objects.length >= 4);
  assert.ok(canExplode(path([{ x: 0, y: 0 }, { x: 3000, y: 0 }])));
  assert.equal(canExplode(createLandscapeObject('fence-line', 0, 0, { points: [{ x: 0, y: 0 }, { x: 1000, y: 0 }] })), false);
});

test('плиты и доски после разрыва: ведомость «N шт», DXF, 3D, экспорт', () => {
  const res = explodePath(path(SHAPES['поворот 90°'], { laying: 'strict' }));
  const rows = landscapeSchedule(res.objects);
  const row = rows.find((r) => r.kind === 'slab');
  assert.equal(row.count, res.objects.length);
  assert.equal(row.unit, 'шт');
  const nat = landscapeSchedule(explodePath(path(SHAPES['поворот 90°'])).objects);
  assert.equal(nat.filter((r) => r.kind === 'slab').length, 1, 'разные размеры — одна строка');
  assert.equal(nat[0].size, 'разные');
  const dxf = landscapeDxfEntities({ landscape: { objects: res.objects } });
  assert.equal(dxf.length, res.objects.length * 4);
  assert.ok(dxf.every((e) => e.layer === 'lsPaths'));
  const project = createProject();
  project.site.landscape.objects.push(...res.objects);
  assert.equal(landscapeFaces(project).length, res.objects.length * 6, 'каждая плита — призма');
  const exp = buildStructuredExport(project);
  const slab = exp.site.landscape.objects.find((x) => x.kind === 'slab');
  assert.ok(slab.area_m2 > 0 && slab.cover);
});

test('хранение: углы и укладка переживают сохранение, битые значения отброшены, вершины по углам', () => {
  const o = path(SHAPES['зигзаг'], {
    corner: 'round', laying: 'strict', slabL: 420, slabW: 780, gap: 140, align: 'right', offset: 75, checker: true,
    vcorners: [null, 'butt', null, 'slab', null], variant: 'stepping',
  });
  const deck = path(SHAPES['поворот 90°'], { variant: 'deck', deck: 'stagger', boardW: 120, boardL: 900 });
  const p = createProject();
  p.site.landscape.objects.push(o, deck);
  const back = deserializeProject(serializeProject(p)).site.landscape.objects;
  const [a, b] = back;
  for (const k of ['corner', 'laying', 'slabL', 'slabW', 'gap', 'align', 'offset', 'checker']) assert.deepEqual(a[k], o[k], k);
  assert.deepEqual(a.vcorners, [null, 'butt', null, 'slab', null]);
  for (const k of ['deck', 'boardW', 'boardL']) assert.equal(b[k], deck[k]);
  const bad = normalizeLandscape({ objects: [{ ...o, corner: 'zigzag', laying: 'x', gap: 'abc', vcorners: ['butt'], align: 'top' }] }).objects[0];
  for (const k of ['corner', 'laying', 'gap', 'vcorners', 'align']) assert.equal(bad[k], undefined, k);
  // Старый объект без полей — без полей и после нормализации.
  const plain = normalizeLandscape({ objects: [{ kind: 'path', x: 0, y: 0, points: SHAPES['поворот 90°'], variant: 'pavers' }] }).objects[0];
  for (const k of ['corner', 'laying', 'vcorners', 'gap']) assert.equal(plain[k], undefined);
  // Вставка и удаление вершины сдвигают углы по вершинам.
  insertVertex(a, 0, { x: 2000, y: 0 });
  assert.deepEqual(a.vcorners, [null, null, 'butt', null, 'slab', null]);
  removeVertex(a, 2);
  assert.deepEqual(a.vcorners, [null, null, null, 'slab', null]);
  // Угол по вершине действует только в ней.
  const lay = lineLayout({ ...a, laying: undefined });
  assert.equal(lay.runs.filter((r) => r.kind === 'arc').length, 2, 'скругление в двух вершинах, угловая — в одной');
});

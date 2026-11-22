// IFC4: устойчивые GUID, строки STEP, целостность ссылок, состав модели.
// Полная проверка схемой и геометрией — scripts/check-ifc.py (IfcOpenShell).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIfc, ifcGuid, stepString } from '../core/ifc.js';
import { buildTemplate } from '../core/templates.js';

test('GUID IFC: 22 символа, набор IFC, устойчивый и разный', () => {
  const a = ifcGuid('проект|wall-1');
  assert.match(a, /^[0-3][0-9A-Za-z_$]{21}$/);
  assert.equal(ifcGuid('проект|wall-1'), a);
  assert.notEqual(ifcGuid('проект|wall-2'), a);
});

test('строки STEP: кириллица в \\X2\\, кавычки удваиваются', () => {
  assert.equal(stepString('Дом'), "'\\X2\\0414043E043C\\X0\\'");
  assert.equal(stepString("O'Neil 1"), "'O''Neil 1'");
  // К у х н я → 041A 0443 0445 043D 044F; пробел и цифра — как есть.
  assert.equal(stepString('Кухня 2'), "'\\X2\\041A04430445043D044F\\X0\\ 2'");
});

test('модель двухэтажного шаблона: состав и целостность ссылок', () => {
  const p = buildTemplate('two-storey');
  p.levels[0].items.push({ id: 'c1', kind: 'column', x: 2500, y: 2200, w: 400, h: 400, rotation: 15 });
  const { text, counts } = buildIfc(p, { timestamp: new Date('2026-11-02T00:00:00Z') });
  assert.ok(text.startsWith('ISO-10303-21;\nHEADER;'));
  assert.match(text, /FILE_SCHEMA\(\('IFC4'\)\);/);
  assert.ok(text.trimEnd().endsWith('END-ISO-10303-21;'));
  const count = (t) => (text.match(new RegExp(`=${t}\\(`, 'g')) || []).length;
  assert.equal(count('IFCBUILDINGSTOREY'), 2);
  assert.equal(count('IFCSPACE'), 11);
  assert.equal(count('IFCDOOR'), counts.doors);
  assert.equal(count('IFCWINDOW'), counts.windows);
  assert.equal(count('IFCOPENINGELEMENT'), counts.doors + counts.windows);
  assert.equal(count('IFCRELVOIDSELEMENT'), counts.doors + counts.windows);
  assert.equal(count('IFCCOLUMN'), 1);
  // Каждая ссылка #n определена; GlobalId уникальны.
  const defined = new Set([...text.matchAll(/^#(\d+)=/gm)].map((m) => m[1]));
  for (const m of text.matchAll(/#(\d+)(?!=)/g)) assert.ok(defined.has(m[1]), `#${m[1]} не определена`);
  const guids = [...text.matchAll(/=IFC[A-Z]+\('([0-9A-Za-z_$]{22})'/g)].map((m) => m[1]);
  assert.equal(new Set(guids).size, guids.length);
  // Повторный экспорт — те же GUID (устойчивость для BIM).
  assert.equal(buildIfc(p, { timestamp: new Date('2026-11-02T00:00:00Z') }).text, text);
});

test('±0.000 и производный фундамент входят в IFC', () => {
  const p = buildTemplate('one-storey');
  p.envelope.zeroAboveGround = 1000;
  p.envelope.foundation.depth = 800;
  const { text, counts } = buildIfc(p, { timestamp: new Date(0) });
  assert.equal(counts.foundations, 1);
  assert.equal((text.match(/=IFCFOOTING\(/g) || []).length, 1);
  assert.match(text, /=IFCSITE\([^;]*,1000\.,\$,\$\)/, 'RefElevation участка — абсолютный ±0.000');
  assert.match(text, /IFCFOOTING\([^;]*\.NOTDEFINED\.\)/);
});

test('мебель в IFC: IfcFurniture, части составной — отдельными элементами через IfcRelAggregates', async () => {
  const { createItem } = await import('../core/model.js');
  const { withDefaultComp } = await import('../core/composite.js');
  const p = buildTemplate('two-storey');
  const items = p.levels[0].items;
  items.push(createItem('bed-double', 3000, 3000, 1600, 2000, 90));
  items.push(withDefaultComp(createItem('dining-table', 2000, 2000, 1600, 900))); // 4 стула
  items.push(withDefaultComp(createItem('sofa', 4000, 2000, 1, 1))); // 4 модуля
  items.push(createItem('table-round', 5000, 5000, 900, 900));
  const { text, counts } = buildIfc(p, { timestamp: new Date('2026-11-02T00:00:00Z') });
  const count = (t) => (text.match(new RegExp(`=${t}\\(`, 'g')) || []).length;
  assert.ok(counts.furniture >= 4);
  assert.equal(counts.furnitureParts, 8);
  assert.equal(count('IFCFURNITURE'), counts.furniture + counts.furnitureParts);
  assert.equal((text.match(/IFCFURNITURE\([^;]*\.SOFA\.\)/g) || []).length, 5, 'диван и 4 модуля');
  assert.equal((text.match(/IFCFURNITURE\([^;]*\.CHAIR\.\)/g) || []).length >= 4, true);
  assert.equal(count('IFCELLIPSEPROFILEDEF') >= 1, true, 'круглый стол — эллипс');
  // Две связи «целое — части»: стол и диван; части не входят в этаж напрямую.
  const rels = [...text.matchAll(/=IFCRELAGGREGATES\('[^']+',#\d+,\$,\$,(#\d+),\(([^)]*)\)\)/g)];
  const furnIds = new Set([...text.matchAll(/^(#\d+)=IFCFURNITURE\(/gm)].map((m) => m[1]));
  const furnRels = rels.filter((m) => furnIds.has(m[1]));
  assert.equal(furnRels.length, 2);
  const partIds = furnRels.flatMap((m) => m[2].split(','));
  assert.equal(partIds.length, 8);
  for (const m of text.matchAll(/=IFCRELCONTAINEDINSPATIALSTRUCTURE\([^;]*\(([^)]*)\),#\d+\)/g)) {
    for (const id of m[1].split(',')) assert.ok(!partIds.includes(id), 'часть не в этаже');
  }
  // Ссылки определены, GUID уникальны, повторный экспорт тот же.
  const defined = new Set([...text.matchAll(/^#(\d+)=/gm)].map((m) => m[1]));
  for (const m of text.matchAll(/#(\d+)(?!=)/g)) assert.ok(defined.has(m[1]), `#${m[1]} не определена`);
  const guids = [...text.matchAll(/=IFC[A-Z]+\('([0-9A-Za-z_$]{22})'/g)].map((m) => m[1]);
  assert.equal(new Set(guids).size, guids.length);
  assert.equal(buildIfc(p, { timestamp: new Date('2026-11-02T00:00:00Z') }).text, text);
});

test('IfcWall — только стены own/shared: стыки и фаски входят в тело стены-хозяина', async () => {
  const { readFileSync } = await import('node:fs');
  const { deserializeProject, levelProject } = await import('../core/model.js');
  const { deriveWalls, wallRects, wallsEngine } = await import('../core/walls.js');
  const p = deserializeProject(readFileSync(new URL('./fixtures/user-house-2026-11.json', import.meta.url), 'utf8'));
  let expected = 0;
  let patches = 0;
  for (const lv of p.levels) {
    const lp = levelProject(p, lv.id);
    const walls = deriveWalls(lp);
    expected += walls.filter((w) => !w.hidden && (w.kind === 'own' || w.kind === 'shared') &&
      wallRects(w).some((r) => r.w >= 1 && r.h >= 1)).length;
    patches += walls.filter((w) => w.kind === 'joint' || w.kind === 'chamfer').length;
    expected += lp.items.filter((it) => it.kind === 'wall-free').length;
  }
  // v2 (стена = область): заплаток нет, углы — в кусках rects самих стен.
  if (wallsEngine(p) === 'v1') assert.ok(patches > 0, 'в проекте есть заплатки стыков');
  else assert.equal(patches, 0);
  const { text, counts } = buildIfc(p, { timestamp: new Date(0) });
  assert.equal((text.match(/=IFCWALL\(/g) || []).length, expected);
  assert.equal(counts.walls, expected);
  assert.ok(!text.includes(stepString('Стена (стык)')), 'нет отдельных «Стена (стык)»');
  // v1: хотя бы у одной стены несколько тел (заплатка стыка).
  if (wallsEngine(p) === 'v1') assert.match(text, /IFCSHAPEREPRESENTATION\([^)]*'Body','SweptSolid',\(#\d+,#\d+/);
});

// Разбор STEP: #id → тело записи; профиль тела стены → кольца точек (IFC, Y вверх).
function stepIndex(text) {
  const map = new Map();
  for (const m of text.matchAll(/^#(\d+)=(.*);$/gm)) map.set(`#${m[1]}`, m[2]);
  const refs = (s) => [...s.matchAll(/#\d+/g)].map((m) => m[0]);
  const point = (id) => { const [x, y] = /\(\(([^)]*)\)\)/.exec(map.get(id))[1].split(',').map(Number); return { x, y }; };
  const ring = (polyline) => refs(map.get(polyline)).map(point).slice(0, -1);
  const area = (pts) => pts.reduce((s, a, i) => { const b = pts[(i + 1) % pts.length]; return s + a.x * b.y - b.x * a.y; }, 0) / 2;
  // Профили тел стены: [{ kind, outer, holes }].
  const wallProfiles = (wallId) => {
    const shapeId = refs(map.get(wallId)).at(-1);
    const repId = refs(map.get(shapeId)).at(-1);
    const solids = refs(map.get(repId)).slice(1);
    return solids.map((s) => {
      const prof = refs(map.get(s))[0];
      const body = map.get(prof);
      if (body.startsWith('IFCRECTANGLEPROFILEDEF')) return { kind: 'rect' };
      const [outer, ...holes] = refs(body).map(ring);
      return { kind: body.startsWith('IFCARBITRARYPROFILEDEFWITHVOIDS') ? 'voids' : 'poly', outer, holes };
    });
  };
  return { map, wallProfiles, area };
}

test('v2: тело IfcWall — контур области стены (не куски), площадь профилей = площадь кусков', { skip: process.env.KEPLER_WALLS === 'v1' && 'проверка движка v2' }, async () => {
  const { readFileSync } = await import('node:fs');
  const { deserializeProject, levelProject } = await import('../core/model.js');
  const { deriveWalls, wallRects } = await import('../core/walls.js');
  const p = deserializeProject(readFileSync(new URL('./fixtures/user-house-2026-11.json', import.meta.url), 'utf8'));
  const { text } = buildIfc(p, { timestamp: new Date(0) });
  const { map, wallProfiles, area } = stepIndex(text);
  const wallIds = [...map.entries()].filter(([, b]) => b.startsWith('IFCWALL(')).map(([id]) => id);
  let rectArea = 0;
  for (const lv of p.levels) {
    for (const w of deriveWalls(levelProject(p, lv.id))) {
      if (w.hidden || (w.kind !== 'own' && w.kind !== 'shared' && w.kind !== 'manual')) continue;
      rectArea += wallRects(w).filter((r) => r.w >= 1 && r.h >= 1).reduce((s, r) => s + r.w * r.h, 0);
    }
  }
  let profArea = 0;
  let multiPiece = 0;
  for (const id of wallIds) {
    const profiles = wallProfiles(id);
    for (const pr of profiles) {
      if (pr.kind === 'rect') continue; // свободная стена (wall-free) — брусок
      assert.ok(area(pr.outer) > 0, 'внешний контур против часовой');
      for (const h of pr.holes) assert.ok(area(h) < 0, 'дыра по часовой');
      profArea += area(pr.outer) + pr.holes.reduce((s, h) => s + area(h), 0);
    }
    if (profiles.length > 1) multiPiece += 1;
  }
  // Площадь контуров совпадает с площадью кусков (без наложений и потерь).
  assert.ok(Math.abs(profArea - rectArea) < 1, `${profArea} ≠ ${rectArea}`);
  // В доме много Г/Т-узлов: куски каждой стены сливаются в один профиль.
  assert.ok(multiPiece < wallIds.length / 4, `несвязных стен ${multiPiece} из ${wallIds.length}`);
});

test('v2: дыра в теле стены вырезается (IfcArbitraryProfileDefWithVoids)', async () => {
  const { wallContours } = await import('../core/ifc.js');
  // Рамка 1000×1000 из 4 кусков толщиной 200 вокруг дыры 600×600.
  const rects = [
    { x: 0, y: 0, w: 1000, h: 200 }, { x: 0, y: 800, w: 1000, h: 200 },
    { x: 0, y: 200, w: 200, h: 600 }, { x: 800, y: 200, w: 200, h: 600 },
  ];
  const c = wallContours(rects);
  assert.equal(c.length, 1);
  assert.equal(c[0].holes.length, 1);
  // Остров в дыре — отдельная область без дыр.
  const withIsland = wallContours([...rects, { x: 400, y: 400, w: 200, h: 200 }]);
  assert.equal(withIsland.length, 2);
  assert.equal(withIsland.filter((x) => x.holes.length === 1).length, 1);
});

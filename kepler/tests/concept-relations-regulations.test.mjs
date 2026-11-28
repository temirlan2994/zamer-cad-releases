import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createRoom, createLevel, createItem, createOpening } from '../core/model.js';
import { changeLevelGeometry } from '../core/level-changes.js';
import { auditModelLinks } from '../core/model-audit.js';
import { roomChecks, normsReport } from '../core/norms.js';
import { analyzeRegulations } from '../core/concept-regulations.js';
import { analyzeConstructability } from '../core/concept-construction.js';

test('изменение этажа сдвигает верхние отметки и подъём связанной лестницы, неверный ввод атомарен', () => {
  const p = createProject(); p.rooms.push(createRoom('living', 0, 0, 6000, 5000));
  const upper = createLevel('2 этаж', 3000, 3000, 'L2'); upper.rooms.push(createRoom('bedroom', 0, 0, 6000, 5000)); p.levels.push(upper);
  const stair = createItem('stairs', 2000, 2000); stair.toLevel = upper.id; p.items.push(stair);
  changeLevelGeometry(p, 'L1', { height: 3400 });
  assert.equal(upper.elevation, 3400); assert.equal(stair.floorHeight, 3400);
  const before = JSON.stringify(p); assert.throws(() => changeLevelGeometry(p, 'L1', { elevation: NaN })); assert.equal(JSON.stringify(p), before);
  changeLevelGeometry(p, upper.id, { elevation: 3600 }); assert.equal(stair.floorHeight, 3600);
  assert.equal(auditModelLinks(p).status, 'checked');
});

test('отсутствие нормативного профиля не становится соответствием; неполный пользовательский профиль неизвестен', () => {
  const p = createProject(); p.rooms.push(createRoom('living', 0, 0, 2000, 2000));
  assert.equal(analyzeRegulations(p).status, 'unknown');
  p.concept = { regulations: { profile: 'KG' } }; assert.ok(analyzeRegulations(p).checks.every((c) => c.status === 'unknown'));
  p.concept.regulations = { profile: 'custom', region: 'Тест', title: 'Задание', limits: { livingArea: 12 } };
  assert.equal(analyzeRegulations(p).applicable, false);
  Object.assign(p.concept.regulations, { source: 'Документ заказчика', revision: '1', scope: 'Тестовый дом', confirmedBy: 'Архитектор', confirmedAt: '2026-11-27' });
  assert.equal(analyzeRegulations(p).status, 'blocked');
  assert.equal(analyzeRegulations(p).checks.find((c) => c.key === 'livingArea').status, 'fail');
});

test('конструктивные данные и геометрические противоречия остаются различимы', () => {
  const p = createProject(); p.rooms.push(createRoom('living', 0, 0, 6000, 5000));
  assert.equal(analyzeConstructability(p).status, 'unknown');
  p.concept = { construction: { system: 'masonry', layers: [{ material: 'Блок', thickness: 400 }], maxSpan: 4000 } };
  const report = analyzeConstructability(p);
  assert.ok(report.findings.some((f) => f.id === 'layers-thickness' && f.status === 'attention'));
  assert.ok(report.findings.some((f) => f.id.startsWith('span:')));
  assert.ok(report.findings.some((f) => f.status === 'unknown'));
});

 test('основной отчёт не подменяет неизвестный регион российскими порогами', () => {
  const p = createProject(); const room = createRoom('living',0,0,5000,4000); p.rooms.push(room);
  p.concept = { regulations: { profile: 'KG' } };
  assert.deepEqual(roomChecks(p,room,p.levels[0]), []);
  const report = normsReport(p, { enabled: ['norms'] });
  assert.equal(report.regulatoryUnknown, true); assert.equal(report.ok, false);
  p.concept.regulations = { profile: 'custom', region:'Тест', title:'Задание', source:'Источник', revision:'1', scope:'Дом', confirmedBy:'Автор', confirmedAt:'2026-11-27', limits:{ livingArea:25, ceiling:2500, daylightRatio:.1, corridorWidth:900, kitchenArea:8, bedroomArea:10 } };
  assert.equal(roomChecks(p,room,p.levels[0]).find((check)=>check.kind==='area').ok,false);
  p.concept.regulations.limits.livingArea = 15;
  assert.equal(roomChecks(p,room,p.levels[0]).find((check)=>check.kind==='area').ok,true);
 });

 test('просвет лестницы проверяется до реального перекрытия, вне его контура ложного конфликта нет', () => {
  const p=createProject();p.rooms.push(createRoom('living',0,0,6000,5000));const stair=createItem('stairs',1000,1000,1000,3000);p.items.push(stair);
  p.concept={construction:{system:'masonry',soil:'Изыскания',engineer:'Инженер',source:'Задание',layers:[{material:'Кладка',thickness:p.settings.exterior}],minHeadroom:2000}};
  const mesh=[{kind:'stairs',part:'tread',itemId:stair.id,level:'L1',normal:{z:1},pts:[{x:0,y:0,z:500},{x:1000,y:0,z:500},{x:1000,y:300,z:500},{x:0,y:300,z:500}]},
    {kind:'slab',normal:{x:0,y:0,z:-1},pts:[{x:-100,y:-100,z:2000},{x:2000,y:-100,z:2000},{x:2000,y:1000,z:2000},{x:-100,y:1000,z:2000}]}];
  let report=analyzeConstructability(p,{mesh});assert.equal(report.findings.find((f)=>f.id===`headroom:${stair.id}`).status,'blocked');
  mesh[1].pts.forEach((point)=>{point.x+=5000;});report=analyzeConstructability(p,{mesh});
  assert.ok(!report.findings.some((f)=>f.id.startsWith('headroom:')));
  assert.ok(report.findings.some((f)=>f.id==='span-limit' && f.status==='unknown'));
 });

 test('региональная проверка учитывает остеклённую дверь в балконном блоке вместе с окном', () => {
  const p=createProject(),room=createRoom('living',0,0,6000,4000);p.rooms.push(room);
  const opening=createOpening('window',room.id,0,3000,2200);Object.assign(opening,{type:'balcony-swing',height:2300,sill:0,heightMode:'custom',assembly:{}});p.openings.push(opening);
  const light=analyzeRegulations(p).checks.find((check)=>check.key==='daylightRatio');
  assert.ok(Math.abs(light.actual-3.75/24)<.0001);assert.equal(light.status,'reference_pass');
  assert.equal(roomChecks(p,room,p.levels[0]).find((check)=>check.kind==='light').ok,true);
 });

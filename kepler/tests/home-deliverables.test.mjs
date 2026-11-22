import test from 'node:test';
import assert from 'node:assert/strict';

import { analyzeHomeDeliverables } from '../core/home-deliverables.js';
import {
  createLevel, createProject, createRoom, serializeProject,
} from '../core/model.js';
import { addSectionView, addSheet, placeView } from '../core/views.js';

function populatedProject() {
  const project = createProject('Комплект');
  project.rooms.push(createRoom('living', 0, 0, 6000, 5000));
  const upper = createLevel('2 этаж', 3000, 2800, 'L2');
  upper.rooms.push(createRoom('bedroom', 0, 0, 5000, 4000));
  project.levels.push(upper);
  project.site.boundary = [
    { x: -5000, y: -5000 }, { x: 15000, y: -5000 },
    { x: 15000, y: 15000 }, { x: -5000, y: 15000 },
  ];
  return project;
}

const byId = (list, id) => list.find((item) => item.id === id);
const exportByKind = (result, kind) => result.exports.find((item) => item.kind === kind);

test('пустой проект: вычисляемые виды перечислены, но содержимое не выдано за готовое', () => {
  const result = analyzeHomeDeliverables(createProject('Пустой'));

  assert.equal(result.schema, 'kepler-home-deliverables/1');
  assert.equal(result.preliminary, true);
  assert.equal(result.normative, false);
  assert.equal(result.documentationLevel, 'concept');
  assert.equal(result.status, 'missing');
  assert.deepEqual(result.summary, { ready: 0, partial: 0, missing: 6, total: 6 });
  assert.deepEqual(result.checks.map((item) => item.id), [
    'plans', 'site', 'facades', 'sections', 'three-d', 'sheets',
  ]);

  assert.equal(result.views.plans.length, 1);
  assert.equal(result.views.plans[0].status, 'missing');
  assert.deepEqual(result.views.elevations.map((view) => view.id), [
    'elev-N', 'elev-S', 'elev-W', 'elev-E',
  ]);
  assert.ok(result.views.elevations.every((view) => view.computed && view.status === 'missing'));
  assert.equal(byId(result.checks, 'facades').availableCount, 4);
  assert.equal(result.sheets.auto.availableCount, 0);
  assert.equal(result.sheets.total, 0);
  assert.equal(result.documents.schedule.status, 'missing');
  assert.equal(result.documents.tep.status, 'missing');

  assert.equal(exportByKind(result, 'project').available, true);
  assert.equal(exportByKind(result, 'json').available, true);
  assert.equal(exportByKind(result, 'dxf').available, false);
  assert.equal(exportByKind(result, 'ifc').available, false);
  assert.equal(exportByKind(result, 'sheet-pdf').available, false);
  assert.ok(result.exports.every((item) => item.generated === false));
  assert.match(result.limitations.join(' '), /не означает готовность рабочей документации/i);
  assert.match(result.limitations.join(' '), /150 dpi/i);
});

test('дом и участок: два плана, генплан, четыре фасада, 3D и три гарантированных автолиста', () => {
  const project = populatedProject();
  const result = analyzeHomeDeliverables(project);

  assert.equal(byId(result.checks, 'plans').status, 'ready');
  assert.deepEqual(byId(result.checks, 'plans').viewIds, ['plan:L1', 'plan:L2']);
  assert.equal(byId(result.checks, 'site').status, 'ready');
  assert.equal(byId(result.checks, 'facades').count, 4);
  assert.equal(byId(result.checks, 'three-d').status, 'ready');
  assert.equal(byId(result.checks, 'sections').status, 'missing');
  assert.equal(result.status, 'partial', 'нет разреза — комплект не полностью заполнен');

  assert.equal(result.sheets.auto.enabled, true);
  assert.equal(result.sheets.auto.availableCount, 3);
  assert.equal(result.sheets.auto.visibleCount, 3);
  assert.deepEqual(result.sheets.auto.items.map((item) => item.viewId), ['site', 'plan:L1', 'plan:L2']);
  assert.equal(result.sheets.total, 3);
  assert.equal(result.sheets.contentCount, 3);

  assert.deepEqual(
    { status: result.documents.schedule.status, rooms: result.documents.schedule.roomCount, levels: result.documents.schedule.levelCount },
    { status: 'ready', rooms: 2, levels: 2 },
  );
  assert.equal(result.documents.tep.status, 'ready');
  assert.equal(result.documents.tep.houseIndicators, true);
  assert.equal(result.documents.tep.siteIndicators, true);

  for (const kind of ['dxf', 'dxf-revit', 'dxf-site', 'ifc', 'sheet-pdf', 'schedule-csv']) {
    assert.equal(exportByKind(result, kind).available, true, kind);
  }
  assert.equal(exportByKind(result, 'landscape-csv').available, false);
});

test('разрезы и пользовательский лист: фактические viewId, форматы и полная сводка', () => {
  const project = populatedProject();
  const section = addSectionView(project, {
    levelId: 'L1', a: { x: -1000, y: 2000 }, b: { x: 7000, y: 2000 },
  });
  project.site.landscape = {
    objects: [],
    sections: [{
      id: 'ls-a', name: 'А', points: [{ x: -3000, y: 0 }, { x: 12000, y: 0 }],
      side: 'left', depth: 15000,
    }],
  };
  project.sheetsAuto = false;
  const sheet = addSheet(project, { no: '1', name: 'Фасады и разрез', format: 'A2' });
  assert.ok(placeView(project, sheet.id, 'elev-N').viewport);
  assert.ok(placeView(project, sheet.id, section.id).viewport);

  const result = analyzeHomeDeliverables(project);
  const sections = byId(result.checks, 'sections');
  assert.equal(sections.status, 'ready');
  assert.deepEqual(sections.viewIds, [section.id, 'section:ls-a']);
  assert.equal(result.sheets.auto.availableCount, 3);
  assert.equal(result.sheets.auto.visibleCount, 0);
  assert.equal(result.sheets.auto.potential.status, 'unknown');
  assert.equal(result.sheets.auto.potential.count, 1);
  assert.equal(result.sheets.user.count, 1);
  assert.equal(result.sheets.user.validViewportCount, 2);
  assert.equal(result.sheets.user.invalidViewportCount, 0);
  assert.deepEqual(result.sheets.formats, [{ id: 'A2', count: 1 }]);
  assert.equal(result.sheets.total, 1);
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.summary, { ready: 6, partial: 0, missing: 0, total: 6 });
  assert.ok(result.warnings.some((warning) => /неизвестно ядру/i.test(warning)));
});

test('отключённые автолисты и пустой пользовательский лист остаются частичной готовностью', () => {
  const project = populatedProject();
  project.sheetsAuto = false;
  const sheet = addSheet(project, { no: '4' });
  // Ссылка на удалённый/несуществующий вид не считается содержимым листа.
  sheet.viewports.push({ id: 'vp-bad', viewId: 'deleted-view', x: 50, y: 50, scale: 100 });

  const result = analyzeHomeDeliverables(project);
  const sheetsCheck = byId(result.checks, 'sheets');
  assert.equal(sheetsCheck.status, 'partial');
  assert.equal(result.sheets.auto.availableCount, 3);
  assert.equal(result.sheets.auto.count, 0);
  assert.equal(result.sheets.user.emptyCount, 1);
  assert.equal(result.sheets.user.invalidViewportCount, 1);
  assert.deepEqual(result.sheets.emptyUserSheets, [sheet.id]);
  assert.equal(result.sheets.total, 1);
  assert.equal(result.sheets.contentCount, 0);
  assert.equal(exportByKind(result, 'sheet-pdf').available, true, 'технически можно выгрузить пустой пользовательский лист');
  assert.match(exportByKind(result, 'sheet-pdf').reason, /пустыми/i);
  assert.ok(result.warnings.some((warning) => /автолисты отключены/i.test(warning)));
  assert.ok(result.warnings.some((warning) => /удалённые виды/i.test(warning)));
});

test('некорректная граница не создаёт ложный генплан или автолист', () => {
  const project = populatedProject();
  // Самопересекающийся контур с ненулевой алгебраической площадью.
  project.site.boundary = [
    { x: 0, y: 0 }, { x: 10000, y: 0 }, { x: 0, y: 8000 },
    { x: 10000, y: 10000 }, { x: 0, y: 10000 },
  ];
  const result = analyzeHomeDeliverables(project);
  assert.equal(byId(result.checks, 'site').status, 'missing');
  assert.equal(result.sheets.auto.items.some((item) => item.kind === 'site'), false);
  assert.equal(exportByKind(result, 'dxf-site').available, false);
  assert.equal(result.documents.tep.status, 'partial');
});

test('валидная ссылка на пустой 3D-вид не считается содержимым листа', () => {
  const project = createProject('Пустой лист');
  const sheet = addSheet(project, { no: '1' });
  assert.ok(placeView(project, sheet.id, '3d').viewport);

  const result = analyzeHomeDeliverables(project);
  assert.equal(byId(result.checks, 'three-d').status, 'missing');
  assert.equal(byId(result.checks, 'sheets').status, 'partial');
  assert.equal(result.sheets.contentCount, 0);
  assert.equal(result.sheets.user.validViewportCount, 1);
  assert.equal(result.sheets.user.contentViewportCount, 0);
  assert.equal(result.sheets.user.emptyViewportCount, 1);
  assert.deepEqual(result.sheets.user.items[0].emptyViewIds, ['3d']);
  assert.ok(result.warnings.some((warning) => /пустых видов: 1/i.test(warning)));
});

test('одна отметка рельефа и битая кровля не создают ложную 3D/BIM-готовность', () => {
  const project = createProject('Битая геометрия');
  project.site.terrain = { points: [{ id: 'p1', x: 100, y: 200, z: 0 }] };
  project.roofs = [{ id: 'bad-roof', levelId: 'missing', outline: [] }];

  const result = analyzeHomeDeliverables(project);
  assert.equal(byId(result.checks, 'three-d').status, 'missing');
  assert.equal(byId(result.checks, 'facades').status, 'missing');
  assert.equal(exportByKind(result, 'ifc').available, false);
});

test('разрез далеко от дома остаётся пустым, а не готовым', () => {
  const project = populatedProject();
  const section = addSectionView(project, {
    levelId: 'L1',
    a: { x: 100000, y: 100000 }, b: { x: 110000, y: 100000 },
    name: 'Разрез мимо дома',
  });

  const result = analyzeHomeDeliverables(project);
  const record = result.views.sections.building.find((view) => view.id === section.id);
  assert.equal(record.status, 'missing');
  assert.equal(record.hasContent, false);
  assert.equal(byId(result.checks, 'sections').status, 'missing');
  assert.equal(byId(result.checks, 'sections').count, 0);
});

test('анализ не меняет проект и детерминирован при повторном вызове', () => {
  const project = populatedProject();
  const section = addSectionView(project, {
    levelId: 'L1', a: { x: 0, y: 1000 }, b: { x: 6000, y: 1000 },
  });
  const sheet = addSheet(project, { no: '4' });
  placeView(project, sheet.id, section.id);
  const before = serializeProject(project, { pretty: false });

  const first = analyzeHomeDeliverables(project);
  const second = analyzeHomeDeliverables(project);

  assert.equal(serializeProject(project, { pretty: false }), before);
  assert.deepEqual(second, first);
});

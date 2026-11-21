import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeHomeClimateOverview, analyzeHomeClimateRoom, homeClimateOverviewKey } from '../core/home-climate.js';
import { createOpening, createProject, createRoom } from '../core/model.js';

function roomProject({ window = true, type = 'bedroom' } = {}) {
  const project = createProject('Свет и солнце');
  const room = createRoom(type, 0, 0, 5000, 4000);
  room.id = 'room-1';
  project.rooms.push(room);
  if (window) {
    const opening = createOpening('window', room.id, 2, 2500, 1600);
    opening.id = 'window-1';
    project.openings.push(opening);
  }
  return { project, room };
}

test('сводка всего дома остаётся лёгкой и не выдаёт климатический расчёт', () => {
  const { project } = roomProject();
  const before = JSON.stringify(project);
  const result = analyzeHomeClimateOverview(project);

  assert.equal(JSON.stringify(project), before, 'обзор не меняет проект');
  assert.equal(result.schema, 'kepler-home-climate/1');
  assert.equal(result.preliminary, true);
  assert.equal(result.normative, false);
  assert.equal(result.status, 'candidate');
  assert.equal(result.summary.roomCount, 1);
  assert.equal(result.summary.windowCount, 1);
  assert.equal(result.summary.windowlessRoomCount, 0);
  assert.equal(result.sources.climate.status, 'missing');
  assert.equal(result.sources.envelope.status, 'missing');
  assert.equal(result.rooms[0].ventilation.airChangePerHour, null);
  assert.equal(result.rooms[0].ventilation.airflowM3h, null);
  assert.equal('points' in result.rooms[0], false, 'сводка не содержит лучевую сетку');
  assert.match(result.warnings.join(' '), /не рассчитан|не рассчитываются/i);
  assert.equal(homeClimateOverviewKey(project), homeClimateOverviewKey(project));
});

test('координаты по умолчанию остаются ориентировочными до явного подтверждения', () => {
  const { project, room } = roomProject();
  const overview = analyzeHomeClimateOverview(project);
  assert.equal(overview.sources.solar.status, 'estimated');
  assert.equal(overview.sources.solar.verified, false);

  const detail = analyzeHomeClimateRoom(project, {
    roomId: room.id, date: '2026-03-21', maxCells: 16, from: 8 * 60, to: 16 * 60, stepMin: 30,
  });
  assert.equal(detail.directSun.status, 'estimated');
  assert.equal(detail.directSun.verified, false);
  assert.equal(detail.insolation.status, 'unknown');
  assert.equal(detail.normative, false);
  assert.match(detail.warnings.join(' '), /неподтвержд/i);
});

test('открытые террасы и шахты не считаются комнатами без окон', () => {
  const { project } = roomProject();
  project.rooms.push(
    createRoom('terrace', 6000, 0, 4000, 3000),
    createRoom('shaft', 6000, 3500, 1000, 1000),
  );
  const overview = analyzeHomeClimateOverview(project);
  assert.equal(overview.summary.roomCount, 1);
  assert.equal(overview.summary.windowlessRoomCount, 0);
  assert.deepEqual(overview.rooms.map((room) => room.roomId), ['room-1']);
});

test('одна граница участка не превращает инсоляционный ориентир в результат проверки', () => {
  const { project, room } = roomProject();
  project.site.boundary = [
    { x: -1000, y: -1000 }, { x: 8000, y: -1000 },
    { x: 8000, y: 8000 }, { x: -1000, y: 8000 },
  ];
  project.site.solarVerified = false;

  const detail = analyzeHomeClimateRoom(project, {
    roomId: room.id, maxCells: 16, from: 9 * 60, to: 15 * 60, stepMin: 30,
  });
  assert.equal(detail.insolation.status, 'unknown');
  assert.equal(detail.insolation.normative, false);
  assert.match(detail.insolation.reason, /подтвержден/i);
});

test('отсутствие окон является известным фактом, но не ложным нормативным провалом', () => {
  const { project, room } = roomProject({ window: false });
  const detail = analyzeHomeClimateRoom(project, { roomId: room.id, maxCells: 16 });

  assert.equal(detail.daylight.status, 'no_windows');
  assert.equal(detail.daylight.windows, 0);
  assert.equal(detail.daylight.meanLux, 0);
  assert.equal(detail.glazing.referenceStatus, 'none');
  assert.equal(detail.glazing.normative, false);
  assert.equal(detail.thermal.status, 'unknown');
  assert.equal(detail.thermal.numericHours, null);
  assert.equal(detail.thermal.temperatureC, null);
  assert.ok(detail.thermal.missing.includes('climate_file'));
});

test('предварительная вентиляционная точка не становится расходом воздуха или фактом', () => {
  const { project, room } = roomProject({ window: false, type: 'bedroom' });
  project.layoutBrief = { fixedEngineering: [{
    id: 'supply-assumed', kind: 'vent_supply', levelId: project.activeLevel, roomId: room.id,
    x: 1200, y: 1200, dataStatus: 'assumed', sourceRef: 'эскиз',
  }] };

  const overview = analyzeHomeClimateOverview(project);
  assert.equal(overview.rooms[0].ventilation.status, 'candidate');
  assert.deepEqual(overview.rooms[0].ventilation.candidatePointIds, ['supply-assumed']);
  assert.equal(overview.rooms[0].ventilation.airflowM3h, null);

  const detail = analyzeHomeClimateRoom(project, { roomId: room.id, maxCells: 16 });
  assert.equal(detail.ventilation.status, 'candidate');
  assert.equal(detail.ventilation.airChangePerHour, null);
  assert.equal(detail.ventilation.airflowM3h, null);
});

test('подтверждённый солнечный контекст сравнивает только с ориентиром', () => {
  const { project, room } = roomProject();
  project.site.solarVerified = true;
  const detail = analyzeHomeClimateRoom(project, {
    roomId: room.id, date: '2026-03-21', maxCells: 16, from: 8 * 60, to: 16 * 60, stepMin: 30,
  });

  assert.equal(detail.directSun.status, 'verified');
  assert.equal(detail.directSun.verified, true);
  assert.ok(['meets_reference', 'below_reference'].includes(detail.insolation.status));
  assert.equal(detail.insolation.normative, false);
  assert.match(detail.insolation.reason, /ориентир/i);
});

test('неполные координаты дают missing, а не нулевой подтверждённый результат', () => {
  const { project, room } = roomProject();
  project.site.location.lat = null;
  project.site.solarVerified = true;
  const overview = analyzeHomeClimateOverview(project);
  const detail = analyzeHomeClimateRoom(project, { roomId: room.id, maxCells: 16 });

  assert.equal(overview.sources.solar.status, 'missing');
  assert.equal(overview.sources.solar.verified, false);
  assert.equal(detail.directSun.status, 'missing');
  assert.equal(detail.directSun.meanMinutes, null);
  assert.equal(detail.directSun.maxMinutes, null);
  assert.equal(detail.directSun.litShare, null);
  assert.equal(detail.directSun.coverage2h, null);
  assert.equal(detail.insolation.status, 'unknown');
});

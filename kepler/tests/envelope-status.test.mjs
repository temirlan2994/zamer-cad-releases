// Производные статусы компактной панели оболочки.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ENVELOPE_STATUS_KEYS, ENVELOPE_STATUSES, deriveEnvelopeStatus,
} from '../core/envelope-status.js';
import {
  createLevel, createOpening, createProject, createRoom,
} from '../core/model.js';

function house({ door = true, datum = 1000 } = {}) {
  const project = createProject('Статусы оболочки');
  const room = createRoom('living', 0, 0, 5000, 4000);
  room.id = 'living-1';
  project.rooms.push(room);
  if (door) project.openings.push(createOpening('door', room.id, 0, 2500, 1000));
  project.envelope.zeroAboveGround = datum;
  // В этом базовом сценарии водосток намеренно ещё не выбран. Так тест не
  // зависит от того, добавлен ли auto-default в текущую версию createProject.
  delete project.envelope.roofDrainage;
  if (project.envelope.roof) delete project.envelope.roof.drainage;
  return { project, room };
}

test('пустой или отсутствующий проект остаётся неизвестным', () => {
  const expected = {
    datum: 'unknown', foundation: 'unknown', roof: 'unknown',
    drainage: 'unknown', entrance: 'unknown',
  };
  assert.deepEqual(deriveEnvelopeStatus(null), expected);
  assert.deepEqual(deriveEnvelopeStatus(createProject()), expected);
});

test('текущие поля дают готовые ноль, фундамент, автокрышу и наружный вход', () => {
  const { project } = house();
  const before = JSON.stringify(project);
  assert.deepEqual(deriveEnvelopeStatus(project), {
    datum: 'checked',
    foundation: 'checked',
    roof: 'checked',
    drainage: 'unknown',
    entrance: 'checked',
  });
  assert.equal(JSON.stringify(project), before, 'проверка не мутирует проект');
});

test('отсутствующая входная дверь — блокер, а въезд на участок её не заменяет', () => {
  const { project } = house({ door: false });
  project.site.entry = { x: 0, y: 0 };
  assert.equal(deriveEnvelopeStatus(project).entrance, 'blocked');
});

test('явно отключённая система требует внимания, битая конфигурация блокирует', () => {
  const { project } = house();
  project.envelope.foundation.enabled = false;
  project.envelope.roofMode = 'manual';
  project.envelope.roofDrainage = { enabled: false };
  assert.deepEqual(deriveEnvelopeStatus(project), {
    datum: 'checked',
    foundation: 'attention',
    roof: 'blocked',
    drainage: 'attention',
    entrance: 'checked',
  });

  project.envelope.foundation = { type: 'unknown-system', depth: 800 };
  project.envelope.roof = { type: 'origami' };
  project.envelope.roofDrainage = { errors: ['Нет выпуска'] };
  project.entrances = [{ status: 'conflict', reason: 'door-not-on-facade' }];
  const invalid = deriveEnvelopeStatus(project);
  assert.equal(invalid.foundation, 'blocked');
  assert.equal(invalid.roof, 'blocked');
  assert.equal(invalid.drainage, 'blocked');
  assert.equal(invalid.entrance, 'blocked');
});

test('ручная валидная крыша и её маркер водостока поддерживаются', () => {
  const { project } = house();
  project.envelope.roofMode = 'manual';
  project.roofs = [{
    id: 'roof-1', levelId: 'L1', drain: true,
    outline: [
      { x: -500, y: -500 }, { x: 5500, y: -500 },
      { x: 5500, y: 4500 }, { x: -500, y: 4500 },
    ],
  }];
  assert.equal(deriveEnvelopeStatus(project).roof, 'checked');
  assert.equal(deriveEnvelopeStatus(project).drainage, 'checked');

  project.roofs[0].drain = false;
  assert.equal(deriveEnvelopeStatus(project).drainage, 'attention');
  project.roofs[0].levelId = 'deleted-level';
  assert.equal(deriveEnvelopeStatus(project).roof, 'blocked');
});

test('старые верхнеуровневые поля читаются без обязательного envelope', () => {
  const { project } = house();
  delete project.envelope;
  project.site.terrain = { floorZ: 125000 };
  project.foundation = { enabled: true, type: 'strip', depth: 1200 };
  project.roof = { mode: 'auto', type: 'hip', pitchDeg: 18 };
  project.drainage = true;
  assert.deepEqual(deriveEnvelopeStatus(project), {
    datum: 'checked',
    foundation: 'checked',
    roof: 'checked',
    drainage: 'checked',
    entrance: 'checked',
  });
});

test('будущие параметры кровли, водостока и готовой входной группы распознаются', () => {
  const { project } = house({ door: false });
  Object.assign(project.envelope, {
    roofType: 'gable',
    roofPitchDeg: 24,
    roofDirection: 'e',
    roofOverhang: { n: 600, e: 700, s: 600, w: 700 },
    roofDrainage: { enabled: true, mode: 'external' },
  });
  project.entrances = [{
    id: 'auto-entry:door-1', source: 'linked', openingId: 'door-1',
    status: 'ready', landing: {}, steps: { enabled: true }, components: [{ id: 'step-1' }],
  }];
  const result = deriveEnvelopeStatus(project);
  assert.equal(result.roof, 'checked');
  assert.equal(result.drainage, 'checked');
  assert.equal(result.entrance, 'checked');
});

test('подвал без занятого отрицательного уровня требует внимания', () => {
  const { project } = house();
  project.envelope.foundation.type = 'basement';
  assert.equal(deriveEnvelopeStatus(project).foundation, 'attention');

  const basement = createLevel('Подвал', -2800, 2800, 'B1');
  basement.rooms.push(createRoom('storage', 0, 0, 3000, 3000));
  project.levels.push(basement);
  assert.equal(deriveEnvelopeStatus(project).foundation, 'checked');
});

test('входная группа без проектного нуля остаётся ожидающей, а не готовой', () => {
  const { project } = house({ door: false, datum: null });
  project.entrances = [{
    id: 'auto-entry:door-1', status: 'pending', reason: 'building-datum-required',
  }];
  assert.equal(deriveEnvelopeStatus(project).datum, 'unknown');
  assert.equal(deriveEnvelopeStatus(project).entrance, 'unknown');
});

test('контракт содержит только известные ключи и статусы', () => {
  const result = deriveEnvelopeStatus(house().project);
  assert.deepEqual(Object.keys(result), ENVELOPE_STATUS_KEYS);
  assert.ok(Object.values(result).every((status) => ENVELOPE_STATUSES.includes(status)));
});

test('удаление единственной видимой крыши меняет статусы кровли и водостока', () => {
  const { project } = house();
  const upper = createLevel('2 этаж', 3000, 3000, 'L2');
  const bedroom = createRoom('bedroom', 0, 0, 5000, 4000);
  project.levels.push(upper);
  upper.rooms.push(bedroom);
  project.envelope.roof.drainage = 'external';
  bedroom.linkedRoof = false;
  assert.equal(deriveEnvelopeStatus(project).roof, 'attention');
  assert.equal(deriveEnvelopeStatus(project).drainage, 'unknown');
  delete bedroom.linkedRoof;
  assert.equal(deriveEnvelopeStatus(project).roof, 'checked');
  assert.equal(deriveEnvelopeStatus(project).drainage, 'checked');
});

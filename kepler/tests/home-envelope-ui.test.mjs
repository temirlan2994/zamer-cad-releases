import test from 'node:test';
import assert from 'node:assert/strict';

import { createItem, createLevel, createProject, createRoom } from '../core/model.js';

const previousDocument = globalThis.document;
globalThis.document = { getElementById: () => ({ getContext: () => ({}) }) };
const {
  HOME_ENVELOPE_ACTION_IDS, handleHomeEnvelopeClick, homeEnvelopeHtml,
} = await import('../ui/home-envelope.js');
if (previousDocument === undefined) delete globalThis.document;
else globalThis.document = previousDocument;

const analysis = {
  status: 'attention',
  indicators: {
    footprintM2: 80.5, grossFloorAreaM2: 145.2, totalAreaM2: 132.4,
    buildingVolumeM3: 471.8, storeys: 2, heightM: 6.4,
  },
  levels: [
    { id: 'L1', name: '1 этаж', elevationMm: 0, heightMm: 3000, roomCount: 5, footprintM2: 80.5, occupied: true },
    { id: 'L2', name: '2 этаж', elevationMm: 3000, heightMm: 3000, roomCount: 3, footprintM2: 64.7, occupied: true },
  ],
  roofs: {
    records: [{
      id: 'roof-1', name: 'Крыша 1', levelName: '2 этаж', outlineVertexCount: 4,
      thicknessMm: 300, status: 'explicit',
    }],
  },
  vertical: {
    status: 'candidate',
    stairs: [{ id: 'stair-1', status: 'explicit', targetLevelId: 'L2' }],
    slabOpenings: [{ id: 'opening-1', levelId: 'L2', stairId: 'stair-1' }],
  },
  facades: {
    records: [
      { id: 'elev-N', name: 'Фасад Север' }, { id: 'elev-S', name: 'Фасад Юг' },
      { id: 'elev-W', name: 'Фасад Запад' }, { id: 'elev-E', name: 'Фасад Восток' },
    ],
  },
  sections: { records: [{ id: 'sec-1', name: 'Разрез А' }] },
  unknowns: [{ id: 'vertical-check', text: 'Связь лестницы и проёма нужно проверить.' }],
  limitations: ['Теплотехнический расчёт не выполнялся.'],
};

function envelopeButton(dataset, textContent = '') {
  const button = {
    dataset,
    textContent,
    closest: (selector) => (selector === '[data-home-envelope]' ? {} : null),
  };
  return {
    button,
    event: {
      target: {
        closest: (selector) => (selector === '[data-home-envelope-action]' ? button : null),
      },
    },
  };
}

test('этап показывает факты модели и не объявляет конструктивную или теплотехническую готовность', () => {
  const html = homeEnvelopeHtml(createProject('Объём'));
  assert.match(html, /data-home-envelope/);
  assert.match(html, /Геометрия объёма/);
  assert.match(html, /Этажи и отметки/);
  assert.match(html, /Кровли/);
  assert.match(html, /Лестницы и проёмы/);
  assert.match(html, /Открыть чертёж/);
  assert.match(html, /не подтверждает несущую способность/i);
  assert.match(html, /теплотехнику/i);
  assert.doesNotMatch(html, /конструктивн\w* готов|теплотехн\w* готов|норма выполнена/i);
});

test('карточка кровли показывает тип и уклон связанной автокрыши', () => {
  const project = createProject('Вальмовая крыша');
  project.levels[0].rooms.push(createRoom('living', 0, 0, 5000, 4000));
  const html = homeEnvelopeHtml(project, {
    analysis: {
      status: 'attention',
      roofs: {
        autoLinked: true, autoType: 'hip', autoPitchDeg: 24, autoThicknessMm: 250, records: [],
      },
    },
  });
  assert.match(html, /Вальмовая автокровля/);
  assert.match(html, /24°/);
});

test('сводка отражает этажи, явную кровлю, лестницу и существующий разрез', () => {
  const project = createProject('Дом с оболочкой');
  project.levels[0].rooms.push(createRoom('living', 0, 0, 5000, 4000));
  const stair = createItem('stairs', 1800, 1800, 1000, 3000);
  stair.toLevel = 'L2';
  project.levels[0].items.push(stair);
  project.levels[0].slabOpenings = [{ id: 'opening-1', x: 1200, y: 500, w: 1400, h: 3200 }];
  project.levels.push(createLevel('2 этаж', 3000, 3000, 'L2'));
  project.roofs = [{
    id: 'roof-1', name: 'Крыша 1', levelId: 'L2', thickness: 300,
    outline: [{ x: 0, y: 0 }, { x: 5000, y: 0 }, { x: 5000, y: 4000 }, { x: 0, y: 4000 }],
  }];
  project.views = [{
    id: 'sec-1', kind: 'section', name: 'Разрез А', levelId: 'L1',
    line: { a: { x: 0, y: 0 }, b: { x: 5000, y: 0 } }, side: 1,
  }];

  const html = homeEnvelopeHtml(project, { analysis });
  assert.match(html, /2 этажа/);
  assert.match(html, /Крыша 1/);
  assert.match(html, /Фасад Север/);
  assert.match(html, /data-home-envelope-view="sec-1"/);
  assert.match(html, /Разрез А/);
  assert.match(html, /data-home-envelope-action="start-section"/);
  assert.match(html, /Связь лестницы и проёма нужно проверить/);
  assert.deepEqual(HOME_ENVELOPE_ACTION_IDS, ['open-3d', 'open-roof-plan', 'open-view', 'start-section']);
});

test('рендер только анализирует и экранирует диагностический текст', () => {
  const calls = [];
  const html = homeEnvelopeHtml(createProject('Без действий'), {
    analyze: (project) => {
      calls.push(project.name);
      return { ...analysis, warnings: ['<img src=x onerror=alert(1)>'] };
    },
    open3d: () => calls.push('3d'),
  });
  assert.deepEqual(calls, ['Без действий']);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('CTA передают точные команды интеграционному слою и сначала закрывают панель', () => {
  const calls = [];
  const deps = {
    closePanel: (options) => calls.push(['close', options]),
    open3d: () => calls.push(['3d']),
    openRoofPlan: () => calls.push(['roof']),
    openView: (id) => calls.push(['view', id]),
    startSection: () => calls.push(['section']),
    announce: (message) => calls.push(['announce', message]),
  };

  assert.equal(handleHomeEnvelopeClick(envelopeButton({ homeEnvelopeAction: 'open-3d' }).event, deps), true);
  assert.deepEqual(calls.slice(0, 2), [['close', { restoreFocus: false }], ['3d']]);
  calls.length = 0;

  assert.equal(handleHomeEnvelopeClick(envelopeButton({ homeEnvelopeAction: 'open-roof-plan' }).event, deps), true);
  assert.deepEqual(calls.slice(0, 2), [['close', { restoreFocus: false }], ['roof']]);
  calls.length = 0;

  assert.equal(handleHomeEnvelopeClick(envelopeButton({
    homeEnvelopeAction: 'open-view', homeEnvelopeView: 'elev-N',
  }, 'Фасад Север').event, deps), true);
  assert.deepEqual(calls.slice(0, 2), [['close', { restoreFocus: false }], ['view', 'elev-N']]);
  calls.length = 0;

  assert.equal(handleHomeEnvelopeClick(envelopeButton({ homeEnvelopeAction: 'start-section' }).event, deps), true);
  assert.deepEqual(calls.slice(0, 2), [['close', { restoreFocus: false }], ['section']]);
});

test('чужие и неполные команды не перехватываются', () => {
  assert.equal(handleHomeEnvelopeClick({ target: { closest: () => null } }), false);
  assert.equal(handleHomeEnvelopeClick(envelopeButton({ homeEnvelopeAction: 'other' }).event), false);
  assert.equal(handleHomeEnvelopeClick(envelopeButton({ homeEnvelopeAction: 'open-view' }).event), false);
});

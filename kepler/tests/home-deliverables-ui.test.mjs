import test from 'node:test';
import assert from 'node:assert/strict';

import { createProject } from '../core/model.js';

const previousDocument = globalThis.document;
globalThis.document = { getElementById: () => ({ getContext: () => ({}) }) };
const {
  HOME_DELIVERABLE_CHECK_IDS, handleHomeDeliverablesClick, homeDeliverablesHtml,
} = await import('../ui/home-deliverables.js');
if (previousDocument === undefined) delete globalThis.document;
else globalThis.document = previousDocument;

function click(button) {
  return {
    target: {
      closest: (selector) => (selector === '[data-home-deliverables-action]' ? button : null),
    },
  };
}

const analysis = {
  status: 'partial',
  summary: { ready: 3, total: 6 },
  checks: [
    { id: 'plans', status: 'ready', summary: 'Планы двух этажей доступны.', count: 2, total: 2, required: true, viewIds: ['plan:L1', 'plan:L2'] },
    { id: 'site', status: 'ready', summary: 'Генплан доступен.', viewId: 'site' },
    { id: 'facades', status: 'partial', summary: 'На листе два фасада.', count: 2, total: 4, required: false, viewIds: ['elev-N', 'elev-S'] },
    { id: 'sections', status: 'missing', summary: 'Разрезы не созданы.' },
    { id: 'three-d', status: 'ready', summary: '3D-вид доступен.', viewId: '3d' },
    { id: 'sheets', status: 'partial', summary: 'Есть один пользовательский лист.', count: 1 },
  ],
  sheets: {
    auto: { enabled: true, count: 3 }, user: { count: 1 }, total: 4,
    formats: [{ id: 'A3', count: 3 }, { id: 'A2', count: 1 }],
  },
  exports: [
    { kind: 'sheet-pdf', label: 'PDF-листы', available: true },
    { kind: 'dxf-site', label: 'Генплан DXF', available: false, reason: 'Нужна граница участка' },
  ],
  warnings: ['Автолисты отключены: доступные планы не входят в текущий альбом.'],
  limitations: ['Проверка не оценивает подписи проектировщика.'],
};

test('панель показывает стабильные шесть пунктов и явные ограничения', () => {
  const html = homeDeliverablesHtml(createProject('Дом'), { analysis });
  assert.match(html, /data-home-deliverables/);
  for (const id of HOME_DELIVERABLE_CHECK_IDS) assert.match(html, new RegExp(`data-home-deliverables-check="${id}"`));
  assert.deepEqual(HOME_DELIVERABLE_CHECK_IDS, ['plans', 'site', 'facades', 'sections', 'three-d', 'sheets']);
  assert.match(html, /3 из 6/);
  assert.match(html, /2 из 4/);
  assert.match(html, /A3 × 3/);
  assert.match(html, /Что нужно исправить или уточнить/);
  assert.match(html, /Автолисты отключены/);
  assert.match(html, /не является рабочей документацией/i);
  assert.match(html, /растровые \(150 dpi\)/i);
  assert.doesNotMatch(html, /общий балл|\d+\s*%/i);
});
test('рендер только анализирует и не вызывает действия', () => {
  const calls = [];
  const html = homeDeliverablesHtml(createProject('Без загрузок'), {
    analyze: (project) => { calls.push(project.name); return analysis; },
    openView: () => calls.push('view'),
    openSheets: () => calls.push('sheets'),
    handleExport: () => calls.push('export'),
  });
  assert.match(html, /Листы и выдача/);
  assert.deepEqual(calls, ['Без загрузок']);
});
test('пользовательский текст экранируется, недоступный экспорт выключен', () => {
  const html = homeDeliverablesHtml(createProject(), {
    analysis: {
      ...analysis,
      checks: analysis.checks.map((entry, index) => index ? entry : { ...entry, summary: '<img src=x onerror=alert(1)>' }),
    },
  });
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /data-home-deliverables-kind="dxf-site" disabled aria-disabled="true"/);
});

test('CTA открывает точный вид', () => {
  const calls = [];
  const button = {
    dataset: { homeDeliverablesAction: 'open-view', homeDeliverablesView: 'elev-W' },
    getAttribute: () => null,
  };
  assert.equal(handleHomeDeliverablesClick(click(button), {
    openView: (viewId) => calls.push(viewId),
  }), true);
  assert.deepEqual(calls, ['elev-W']);
});

test('CTA открывает диспетчер листов и передаёт kind в существующий экспорт', () => {
  const calls = [];
  const sheets = { dataset: { homeDeliverablesAction: 'open-sheets' }, getAttribute: () => null };
  const download = {
    dataset: { homeDeliverablesAction: 'export', homeDeliverablesKind: 'sheet-pdf' },
    getAttribute: () => null,
  };
  assert.equal(handleHomeDeliverablesClick(click(sheets), { openSheets: () => calls.push('sheets') }), true);
  assert.equal(handleHomeDeliverablesClick(click(download), { handleExport: (kind) => calls.push(kind) }), true);
  assert.deepEqual(calls, ['sheets', 'sheet-pdf']);
});

test('неизвестная, неполная и disabled-команда не перехватывается', () => {
  assert.equal(handleHomeDeliverablesClick(click({ dataset: { homeDeliverablesAction: 'other' }, getAttribute: () => null })), false);
  assert.equal(handleHomeDeliverablesClick(click({ dataset: { homeDeliverablesAction: 'export' }, getAttribute: () => null })), false);
  assert.equal(handleHomeDeliverablesClick(click({
    dataset: { homeDeliverablesAction: 'export', homeDeliverablesKind: 'ifc' },
    disabled: true,
    getAttribute: () => 'true',
  })), false);
  assert.equal(handleHomeDeliverablesClick({ target: { closest: () => null } }), false);
});

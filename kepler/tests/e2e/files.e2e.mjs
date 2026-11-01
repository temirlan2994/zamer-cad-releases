// e2e файлов проекта: открытие старых версий формата, сохранение.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startApp, openNew, uploadText } from './helpers.mjs';

const v1 = readFileSync(new URL('../fixtures/v1-project.kepler.json', import.meta.url), 'utf8');

describe('файлы проекта', () => {
  let app;
  before(async () => { app = await startApp(); await openNew(app.page); });
  after(async () => { await app?.close(); });

  it('файл версии 1 открывается и мигрирует до текущего формата', async () => {
    await uploadText(app.page, '#fileInput', 'old.kepler.json', v1);
    await app.page.waitForFunction(() => window.__kepler.state.project.name === 'Дом из версии 1');
    const s = await app.page.evaluate(() => {
      const { project, view } = window.__kepler.state;
      return {
        schema: project.schema,
        legacy: 'planSiteRot' in project || 'viewRotation' in project,
        building: project.building,
        rooms: project.rooms.length,
        viewDeg: ((view.rotation * 180) / Math.PI + 360) % 360,
        aligned: document.getElementById('alignBtn').classList.contains('active'),
      };
    });
    assert.equal(s.schema, 'kepler-plan/3');
    assert.equal(s.legacy, false);
    assert.deepEqual(s.building, { rotation: 0, origin: { x: 0, y: 0 } });
    assert.equal(s.rooms, 2);
    assert.ok(Math.abs(s.viewDeg) < 0.01 || Math.abs(s.viewDeg - 360) < 0.01, `поворот вида ${s.viewDeg}`);
    assert.equal(s.aligned, false, 'дом не повёрнут — «Выровнять» не подсвечена');
    assert.match(await app.page.textContent('#toast'), /Открыт проект/);
  });

  it('файл из будущей версии — понятная ошибка, проект не теряется', async () => {
    const future = JSON.stringify({ schema: 'kepler-plan/99', name: 'Будущее', rooms: [], openings: [], items: [] });
    await uploadText(app.page, '#fileInput', 'future.kepler.json', future);
    await app.page.waitForFunction(() => /более новой версией/.test(document.getElementById('toast').textContent));
    const name = await app.page.evaluate(() => window.__kepler.state.project.name);
    assert.equal(name, 'Дом из версии 1');
  });

  it('без ошибок в консоли', () => {
    assert.deepEqual(app.errors, []);
  });
});

// E2E «Программы дома»: локальный черновик, явное подтверждение,
// переход к размещению помещения и экранная схема реальных связей.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openNew, startApp } from './helpers.mjs';

const programButton = '#projectHomeProgram';
const panel = '#projectRoutePanel';

async function openProgram(page) {
  if (await page.locator(panel).isVisible()) {
    const title = await page.textContent('#projectRoutePanelTitle');
    if (/Программа дома/.test(title || '')) return;
    await page.click('#projectRouteClose');
  }
  await page.click(programButton);
  await page.waitForSelector(`${panel}:not([hidden])`);
  await page.waitForFunction(() => document.querySelector('#projectRoutePanelTitle')?.textContent === 'Программа дома');
}

describe('программа дома', () => {
  let app;

  before(async () => {
    app = await startApp();
    await openNew(app.page);
  });

  after(async () => { await app?.close(); });

  it('хранит ввод как черновик до сохранения и не выдаёт неизвестное за готовность', async () => {
    const { page } = app;
    assert.equal(await page.isVisible(programButton), true);
    assert.equal(await page.getAttribute(programButton, 'data-status'), 'unknown');

    await openProgram(page);
    assert.equal(await page.getAttribute(programButton, 'aria-expanded'), 'true');
    assert.match(await page.textContent('.home-program-preliminary'), /Предварительно предложено/);

    await page.fill('[data-home-program-field="actorCount"]', '2');
    await page.fill('[data-home-program-field="dailySeats"]', '4');
    await page.fill('[data-home-program-field="guestSeats"]', '6');
    await page.fill('[data-home-program-field="simultaneousCooks"]', '2');
    await page.selectOption('[data-home-program-field="socialMode"]', 'combined');
    await page.fill('[data-home-program-field="bedroomCount"]', '1');
    await page.fill('[data-home-program-field="bathroomCount"]', '1');
    await page.selectOption('[data-home-program-option="office"]', 'unknown');

    assert.equal(await page.evaluate(() => window.__kepler.state.project.layoutBrief?.homeProgram ?? null), null,
      'поля формы не меняют проект до явного сохранения');

    await page.click('[data-home-program-action="save"]');
    await page.waitForFunction(() => window.__kepler.state.project.layoutBrief?.homeProgram?.confirmed === true);
    const saved = await page.evaluate(() => ({
      program: structuredClone(window.__kepler.state.project.layoutBrief.homeProgram),
      actors: window.__kepler.state.project.layoutBrief.actors.length,
      capacity: structuredClone(window.__kepler.state.project.layoutBrief.capacity),
    }));
    assert.equal(saved.actors, 2);
    assert.deepEqual(saved.capacity, { dailySeats: 4, guestSeats: 6, simultaneousCooks: 2 });
    assert.equal(saved.program.socialMode, 'combined');
    assert.equal(saved.program.options.office, null, '«Не решено» остаётся null, а не превращается в отказ');
    assert.equal(await page.getAttribute(programButton, 'data-status'), 'incomplete');
    assert.doesNotMatch(await page.textContent('#projectHomeProgramStatus'), /Готова/);

    await page.click('#projectRouteClose');
    await page.waitForFunction(() => document.getElementById('projectRoutePanel').hidden === true);
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'projectHomeProgram');
    await openProgram(page);
    assert.equal(await page.inputValue('[data-home-program-field="bedroomCount"]'), '1');
    assert.equal(await page.inputValue('[data-home-program-option="office"]'), 'unknown');
  });

  it('запускает существующий инструмент для недостающего помещения', async () => {
    const { page } = app;
    await openProgram(page);
    const add = page.locator('[data-home-program-action="add-room"]').first();
    await add.waitFor({ state: 'visible' });
    const requestedType = await add.getAttribute('data-room-type');
    await add.click();
    await page.waitForFunction(() => window.__kepler.state.tool?.kind === 'place-room');

    assert.deepEqual(await page.evaluate(() => ({
      mode: window.__kepler.state.modeName,
      kind: window.__kepler.state.tool?.kind,
      type: window.__kepler.state.tool?.type,
      panelHidden: document.getElementById('projectRoutePanel').hidden,
    })), {
      mode: 'plan', kind: 'place-room', type: requestedType, panelHidden: true,
    });
    await page.keyboard.press('Escape');
  });

  it('показывает на плане только рассчитанные функциональные связи', async () => {
    const { page } = app;
    await page.evaluate(async () => {
      const { createRoom } = await import('./core/model.js');
      const { mutate } = await import('./ui/store.js');
      mutate(() => {
        const project = window.__kepler.state.project;
        project.rooms = [createRoom('kitchen-living', 0, 0, 6000, 4000)];
        project.openings = [];
        project.layoutBrief.homeProgram = {
          confirmed: true,
          socialMode: 'combined',
          bedroomCount: null,
          bathroomCount: null,
          options: {
            guestBedroom: false, office: false, laundry: false, pantry: false,
            wardrobe: false, guestWc: false, garage: false, terrace: false,
          },
        };
      });
    });
    await openProgram(page);
    await page.click('[data-home-program-action="toggle-overlay"]');
    assert.equal(await page.evaluate(() => window.__kepler.state.homeProgramOverlay.on), false,
      'связь функций внутри одной комнаты не включает пустой экранный слой');
    assert.equal(await page.isHidden('#homeProgramLegend'), true);
    assert.equal(await page.isVisible(panel), true, 'панель остаётся открытой и объясняет, чего не хватает');

    await page.evaluate(async () => {
      const { createOpening, createRoom } = await import('./core/model.js');
      const { mutate } = await import('./ui/store.js');
      mutate(() => {
        const project = window.__kepler.state.project;
        const rooms = ['entrance', 'kitchen-living', 'bedroom', 'bathroom']
          .map((type, index) => createRoom(type, index * 3100, 0, 3000, 3000));
        project.rooms = rooms;
        project.openings = [
          createOpening('door', rooms[0].id, 3, 1500, 1000),
          ...rooms.slice(0, -1).map((room) => createOpening('door', room.id, 1, 1500, 900)),
        ];
        project.layoutBrief.homeProgram = {
          confirmed: true,
          socialMode: 'combined',
          bedroomCount: 1,
          bathroomCount: 1,
          options: {
            guestBedroom: false, office: false, laundry: false, pantry: false,
            wardrobe: false, guestWc: false, garage: false, terrace: false,
          },
        };
      });
    });
    await page.waitForFunction(() => document.querySelector('#projectHomeProgram')?.dataset.status === 'ready');

    await openProgram(page);
    await page.click('[data-home-program-action="toggle-overlay"]');
    await page.waitForFunction(() => window.__kepler.state._homeProgramUI?.active === true
      && window.__kepler.state._homeProgramUI.drawnConnectionCount > 0);
    const overlay = await page.evaluate(() => ({
      on: window.__kepler.state.homeProgramOverlay.on,
      mode: window.__kepler.state.modeName,
      eligible: window.__kepler.state._homeProgramUI.eligibleConnectionCount,
      drawn: window.__kepler.state._homeProgramUI.drawnConnectionCount,
      statuses: structuredClone(window.__kepler.state._homeProgramUI.statusCounts),
      panelHidden: document.getElementById('projectRoutePanel').hidden,
    }));
    assert.equal(overlay.on, true);
    assert.equal(overlay.mode, 'plan');
    assert.equal(overlay.panelHidden, true);
    assert.ok(overlay.eligible >= overlay.drawn && overlay.drawn >= 2, JSON.stringify(overlay));
    assert.ok(overlay.statuses.direct >= 3, JSON.stringify(overlay));
    assert.equal(await page.isVisible('#homeProgramLegend'), true);

    await openProgram(page);
    await page.click('[data-home-program-action="toggle-overlay"]');
    await page.waitForFunction(() => window.__kepler.state.homeProgramOverlay.on === false);
    assert.equal(await page.isHidden('#homeProgramLegend'), true);
    assert.deepEqual(app.errors, []);
  });
});

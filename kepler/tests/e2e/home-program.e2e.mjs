// E2E «Программы дома»: локальный черновик, явное подтверждение,
// переход к размещению помещения и экранная схема реальных связей.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openNew, openRouteView, startApp } from './helpers.mjs';

const programButton = '#projectHomeProgram';
const panel = '#projectRoutePanel';

// «Программа дома» открывается из палитры этапов (интерфейс 0.4.5).
async function openProgram(page) {
  if (await page.locator(panel).isVisible()) {
    const title = await page.textContent('#projectRoutePanelTitle');
    if (/Программа дома/.test(title || '')) return;
  }
  await openRouteView(page, 'program');
  await page.waitForFunction(() => document.querySelector('#projectRoutePanelTitle')?.textContent === 'Программа дома');
}

async function step(page, field, delta, times = 1) {
  for (let index = 0; index < times; index += 1) {
    await page.click(`[data-home-program-step="${field}"][data-delta="${delta}"]`);
  }
}

async function planToClient(page, x, y) {
  const box = await page.locator('#canvas').boundingBox();
  const point = await page.evaluate(([px, py]) => window.__kepler.planToScreen(px, py), [x, y]);
  return { x: box.x + point.x, y: box.y + point.y };
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
    assert.equal(await page.isVisible('.home-program-frequency'), false);
    await page.fill('[data-home-program-field="guestCount"]', '5');
    assert.equal(await page.isVisible('.home-program-frequency'), true);
    assert.equal(await page.textContent('[data-program-seats="guests"]'), '7');
    await page.fill('[data-home-program-field="guestCount"]', '0');

    await step(page, 'adultCount', '1');
    await step(page, 'childCount', '1', 2);
    await step(page, 'guestCount', '1', 2);
    await step(page, 'simultaneousCooks', '1');
    await page.locator('[data-home-program-field="guestFrequency"][value="monthly"]').check({ force: true });
    await page.selectOption('[data-home-program-field="socialMode"]', 'combined');
    await step(page, 'bedroomCount', '1', 2);
    await page.selectOption('[data-home-program-bedroom="bedroom-2"][data-bedroom-field="kind"]', 'child');
    await page.selectOption('[data-home-program-bedroom="bedroom-3"][data-bedroom-field="kind"]', 'child');
    await page.locator('[data-home-program-bedroom="bedroom-1"][data-bedroom-field="ensuite"][value="yes"]').check({ force: true });
    await page.locator('[data-home-program-bedroom="bedroom-1"][data-bedroom-field="wardrobe"][value="no"]').check({ force: true });
    await page.locator('[data-home-program-bedroom="bedroom-2"][data-bedroom-field="wardrobe"][value="yes"]').check({ force: true });
    await page.fill('[data-home-program-field="bathroomCount"]', '2');
    await page.locator('[data-home-program-option="office"][value="unknown"]').check({ force: true });
    await page.locator('[data-home-program-option="laundry"][value="yes"]').check({ force: true });
    await page.locator('[data-home-program-option="pantry"][value="no"]').check({ force: true });

    assert.equal(await page.locator('[data-home-program-option="office"]').count(), 3,
      'дополнительное помещение показано тремя видимыми решениями');
    assert.equal(await page.locator('[data-home-program-option="office"]:checked').getAttribute('value'), 'unknown');

    assert.equal(await page.evaluate(() => window.__kepler.state.project.layoutBrief?.homeProgram ?? null), null,
      'поля формы не меняют проект до явного сохранения');

    await page.click('[data-home-program-action="save"]');
    await page.waitForFunction(() => window.__kepler.state.project.layoutBrief?.homeProgram?.confirmed === true);
    const saved = await page.evaluate(() => ({
      program: structuredClone(window.__kepler.state.project.layoutBrief.homeProgram),
      actors: window.__kepler.state.project.layoutBrief.actors.length,
      capacity: structuredClone(window.__kepler.state.project.layoutBrief.capacity),
    }));
    assert.equal(saved.actors, 5);
    assert.deepEqual(saved.capacity, {
      dailySeats: 5,
      guestSeats: 7,
      simultaneousCooks: 2,
      adultCount: 3,
      childCount: 2,
      guestCount: 2,
      guestFrequency: 'monthly',
    });
    assert.equal(saved.program.socialMode, 'combined');
    assert.equal(saved.program.bedroomCount, 3);
    assert.deepEqual(saved.program.bedrooms.map(({ kind, ensuite, wardrobe }) => ({ kind, ensuite, wardrobe })), [
      { kind: 'main', ensuite: true, wardrobe: false },
      { kind: 'child', ensuite: null, wardrobe: true },
      { kind: 'child', ensuite: null, wardrobe: null },
    ]);
    assert.equal(saved.program.options.office, null, '«Не решено» остаётся null, а не превращается в отказ');
    assert.equal(saved.program.options.laundry, true);
    assert.equal(saved.program.options.pantry, false);
    assert.equal(await page.getAttribute(programButton, 'data-status'), 'incomplete');
    assert.doesNotMatch(await page.textContent('#projectHomeProgramStatus'), /Готова/);

    await page.click('#projectRouteClose');
    await page.waitForFunction(() => document.getElementById('projectRoutePanel').hidden === true);
    // Фокус возвращается на кнопку палитры, которой окно открыли.
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'homeViewTab-program');
    await openProgram(page);
    assert.equal(await page.inputValue('[data-home-program-field="adultCount"]'), '3');
    assert.equal(await page.inputValue('[data-home-program-field="childCount"]'), '2');
    assert.equal(await page.inputValue('[data-home-program-field="guestCount"]'), '2');
    assert.equal(await page.inputValue('[data-home-program-field="bedroomCount"]'), '3');
    assert.equal(await page.locator('[data-home-program-option="office"]:checked').getAttribute('value'), 'unknown');
  });

  it('первая группа библиотеки показывает недостающие комнаты и обновляется после размещения и Undo', async () => {
    const { page } = app;
    await page.click('#projectRouteClose');
    await page.click('#boundRoomBtn');
    const firstGroup = page.locator('#roomCards .room-group').first();
    await firstGroup.waitFor({ state: 'visible' });
    assert.match(await firstGroup.textContent(), /^По программе/);

    const programKids = '#roomCards .room-group-program .program-room-card[data-type="kids-room"]';
    assert.equal(await page.textContent(`${programKids} .program-room-count`), '×2');

    await page.click(programKids);
    let point = await planToClient(page, -2500, 0);
    await page.mouse.click(point.x, point.y);
    await page.waitForFunction(() => window.__kepler.state.project.rooms.filter((room) => room.type === 'kids-room').length === 1);
    assert.equal(await page.textContent(`${programKids} .program-room-count`), '×1');

    await page.click(programKids);
    point = await planToClient(page, 2500, 0);
    await page.mouse.click(point.x, point.y);
    await page.waitForFunction(() => window.__kepler.state.project.rooms.filter((room) => room.type === 'kids-room').length === 2);
    assert.equal(await page.locator(programKids).count(), 0, 'выполненная потребность исчезла из первой группы');

    await page.keyboard.press('Control+z');
    await page.waitForFunction(() => window.__kepler.state.project.rooms.filter((room) => room.type === 'kids-room').length === 1);
    assert.equal(await page.textContent(`${programKids} .program-room-count`), '×1', 'Undo вернул потребность');
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
          bedrooms: [{ id: 'bedroom-1', kind: 'adult', ensuite: false, wardrobe: false }],
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

  it('при открытии старой программы сохраняет все спальни и отдельную гостевую', async () => {
    const { page } = app;
    if (await page.isVisible(panel)) await page.click('#projectRouteClose');
    await page.evaluate(async () => {
      window.__kepler.newProject();
      const { mutate } = await import('./ui/store.js');
      mutate(() => {
        window.__kepler.state.project.layoutBrief = {
          actors: [{ id: 'adult-1' }, { id: 'adult-2' }],
          capacity: { dailySeats: 2, guestSeats: 4, simultaneousCooks: 1 },
          homeProgram: {
            confirmed: true, socialMode: 'separate', bedroomCount: 5, bathroomCount: 2,
            options: {
              guestBedroom: true, office: false, laundry: false, pantry: false,
              wardrobe: false, guestWc: false, garage: false, terrace: false,
            },
          },
        };
      });
    });

    await openProgram(page);
    assert.equal(await page.inputValue('[data-home-program-field="bedroomCount"]'), '6');
    assert.equal(await page.locator('.home-program-bedroom-row').count(), 6,
      'пять спален жильцов и отдельная гостевая показаны шестью строками');
    const kinds = await page.locator('[data-bedroom-field="kind"]').evaluateAll((fields) => fields.map((field) => field.value));
    assert.equal(kinds.filter((kind) => kind === 'guest').length, 1);

    await page.click('[data-home-program-action="save"]');
    const saved = await page.evaluate(() => structuredClone(window.__kepler.state.project.layoutBrief.homeProgram));
    assert.equal(saved.bedroomCount, 6);
    assert.equal(saved.bedrooms.length, 6);
    assert.equal(saved.bedrooms.filter(({ kind }) => kind === 'guest').length, 1);
    assert.equal(saved.options.guestBedroom, true);
    assert.deepEqual(app.errors, []);
  });
});

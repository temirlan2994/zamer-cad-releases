import {
  after, before, describe, it,
} from 'node:test';
import assert from 'node:assert/strict';
import { openSample, startApp } from './helpers.mjs';

describe('выбор проектов при запуске', () => {
  let app;
  before(async () => { app = await startApp(); });
  after(async () => { await app?.close(); });

  it('у нового пользователя сначала показаны примеры с эскизами', async () => {
    const { page } = app;
    assert.equal(await page.isHidden('#startRecentSection'), true);
    assert.equal(await page.$$eval('#startTemplates .startup-project-card', (nodes) => nodes.length), 4);
    assert.ok(await page.$$eval('#startTemplates svg .project-preview-room', (nodes) => nodes.length) > 8);
  });

  it('сохранённый проект появляется первым с настоящей миниатюрой и открывается карточкой', async () => {
    const { page } = app;
    await openSample(page);
    const name = await page.evaluate(() => window.__kepler.state.project.name);
    await page.click('#projectsBtn');
    await page.waitForSelector('#prjSave:not([disabled])');
    await page.click('#prjSave');
    await page.waitForSelector('.prj-row .prj-main small:has-text("версий: 1")');
    await page.click('#projectsClose');
    await page.click('#menuBtn');
    const card = '#startRecentProjects .startup-project-card';
    await page.waitForSelector(card);
    assert.equal(await page.textContent(`${card} b`), name);
    assert.ok(await page.$$eval(`${card} svg .project-preview-room`, (nodes) => nodes.length) >= 4);
    await page.click(card);
    await page.waitForSelector('#startScreen', { state: 'hidden' });
    assert.equal(await page.evaluate(() => window.__kepler.state.project.name), name);
    assert.deepEqual(app.errors, []);
  });
});

describe('стартовые окна на телефоне', () => {
  let login;
  let chooser;
  before(async () => {
    login = await startApp({ mobile: true, query: 'authGate=1' });
    chooser = await startApp({ mobile: true });
  });
  after(async () => {
    await login?.close();
    await chooser?.close();
  });

  it('окно входа помещается в 390×844, кнопка не меньше 44 px', async () => {
    const card = await login.page.$eval('.startup-card', (node) => {
      const rect = node.getBoundingClientRect();
      return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, sw: node.scrollWidth, cw: node.clientWidth };
    });
    const button = await login.page.$eval('#startGoogleSignIn', (node) => node.getBoundingClientRect().height);
    assert.ok(card.x >= 0 && card.y >= 0 && card.right <= 390 && card.bottom <= 844);
    assert.ok(card.sw <= card.cw + 1);
    assert.ok(button >= 44);
  });

  it('проекты и примеры складываются в одну колонку', async () => {
    const { page } = chooser;
    const actions = await page.$$eval('#startNew, #startOpen', (nodes) => nodes.map((node) => node.getBoundingClientRect().height));
    const cards = await page.$$eval('#startTemplates .startup-project-card', (nodes) => nodes.slice(0, 2).map((node) => {
      const rect = node.getBoundingClientRect();
      return { x: rect.x, width: rect.width };
    }));
    assert.ok(actions.every((height) => height >= 44));
    assert.equal(Math.round(cards[0].x), Math.round(cards[1].x));
    assert.equal(Math.round(cards[0].width), Math.round(cards[1].width));
    assert.deepEqual(chooser.errors, []);
  });
});

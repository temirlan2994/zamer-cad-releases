import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openSample, startApp } from './helpers.mjs';

describe('закрытый каталог не пересчитывает программу дома', () => {
  let app;
  before(async () => {
    app = await startApp({ width: 1280, height: 820 });
    await openSample(app.page);
  });
  after(async () => { await app?.close(); });

  it('откладывает DOM и анализ до следующего открытия каталога помещений', async () => {
    const { page } = app;
    await page.click('#boundRoomBtn');
    await page.waitForSelector('#roomCards .room-card');

    await page.click('#selectToolBtn');
    await page.waitForFunction(() => !document.body.classList.contains('lib-open'));
    await page.$eval('#roomCards .room-card', (node) => { node.dataset.lazySentinel = 'old'; });
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('kepler:project-change')));
    assert.equal(await page.$eval('#roomCards .room-card', (node) => node.dataset.lazySentinel), 'old',
      'закрытый каталог сохранил DOM и не запускал renderLibrary');

    await page.click('#boundRoomBtn');
    await page.waitForFunction(() => document.body.classList.contains('lib-open'));
    assert.equal(await page.$eval('#roomCards .room-card', (node) => node.dataset.lazySentinel || ''), '',
      'при открытии устаревшие карточки обновились один раз');
  });
});

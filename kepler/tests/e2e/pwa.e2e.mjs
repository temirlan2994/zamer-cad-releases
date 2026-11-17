// PWA на телефоне: браузерное предложение установки и настоящий офлайн-запуск.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.mjs';

describe('установка приложения на телефон и офлайн-запуск', () => {
  let app;

  before(async () => { app = await startApp({ mobile: true, query: 'pwa=1' }); });
  after(async () => { await app?.page.context().setOffline(false); await app?.close(); });

  it('предложение браузера показывает кнопку и запускает установку', async () => {
    const { page } = app;
    await page.evaluate(() => {
      window.__pwaInstallPrompted = 0;
      const event = new Event('beforeinstallprompt', { cancelable: true });
      Object.defineProperties(event, {
        prompt: { value: async () => { window.__pwaInstallPrompted += 1; } },
        userChoice: { value: Promise.resolve({ outcome: 'accepted', platform: 'web' }) },
      });
      window.dispatchEvent(event);
    });
    assert.equal(await page.$eval('#startInstallBtn', (button) => !button.hidden), true);
    assert.equal(await page.isVisible('#startProjectsInstallBtn'), true);
    assert.equal(await page.$eval('#mobileInstallBtn', (button) => !button.hidden), true);
    await page.click('#startProjectsInstallBtn');
    assert.equal(await page.evaluate(() => window.__pwaInstallPrompted), 1);
    await page.waitForFunction(() => document.getElementById('startProjectsInstallBtn').disabled);
    assert.match(await page.textContent('#startProjectsInstallBtn'), /уже установлено/i);
    assert.equal(await page.$eval('#startInstallBtn', (button) => button.hidden), true);
    assert.equal(await page.$eval('#mobileInstallBtn', (button) => button.hidden), true);
  });

  it('на iPhone показывает короткую инструкцию «На экран Домой»', async () => {
    const { page } = app;
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'userAgent', {
        configurable: true,
        get: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
      });
      // В этом сценарии проверяем именно запасной путь Safari, а не событие Chromium.
      window.addEventListener('beforeinstallprompt', (event) => event.stopImmediatePropagation(), true);
    });
    await page.reload();
    await page.waitForFunction(() => Boolean(window.__kepler));
    assert.equal(await page.isVisible('#startProjectsInstallBtn'), true);
    await page.click('#startProjectsInstallBtn');
    assert.equal(await page.isVisible('#installHelpScreen'), true);
    await page.tap('#installHelpClose');
    assert.equal(await page.isVisible('#installHelpScreen'), false);
  });

  it('в уже установленном приложении экран проектов показывает его состояние', async () => {
    const { page } = app;
    await page.addInitScript(() => {
      const browserMatchMedia = window.matchMedia.bind(window);
      window.matchMedia = (query) => {
        if (query !== '(display-mode: standalone)') return browserMatchMedia(query);
        return {
          matches: true,
          media: query,
          onchange: null,
          addEventListener() {},
          removeEventListener() {},
          addListener() {},
          removeListener() {},
          dispatchEvent: () => true,
        };
      };
    });
    await page.reload();
    await page.waitForFunction(() => Boolean(window.__kepler));
    const state = await page.$eval('#startProjectsInstallBtn', (button) => ({
      visible: !button.hidden,
      disabled: button.disabled,
      text: button.textContent,
    }));
    assert.equal(state.visible, true);
    assert.equal(state.disabled, true);
    assert.match(state.text, /уже установлено/i);
    assert.equal(await page.$eval('#startInstallBtn', (button) => button.hidden), true);
    assert.equal(await page.$eval('#mobileInstallBtn', (button) => button.hidden), true);
  });

  it('service worker управляет страницей и открывает её без сети', async () => {
    const { page } = app;
    const ready = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      return { scope: registration.scope, updateViaCache: registration.updateViaCache };
    });
    assert.match(ready.scope, /^http:\/\/127\.0\.0\.1:\d+\//);
    assert.equal(ready.updateViaCache, 'none');

    // Первая загрузка ставит worker, следующая уже проходит под его контролем.
    await page.reload();
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller && window.__kepler));
    await page.context().setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller && window.__kepler));
    assert.match(await page.title(), /kep•ler 3D$/);
    assert.equal(await page.isVisible('#startScreen'), true);
    await page.context().setOffline(false);
  });
});

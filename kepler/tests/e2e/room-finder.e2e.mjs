import assert from 'node:assert/strict';
import { it } from 'node:test';
import { settleView, startApp } from './helpers.mjs';

for (const mobile of [false, true]) {
  it(`экспликация: поиск по дому и переход к комнате на другом этаже (${mobile ? 'телефон' : 'компьютер'})`, async () => {
    const app = await startApp({ mobile, viewSections: 'default' });
    const { page } = app;
    try {
      await page.getByRole('button', { name: /Двухэтажный/ }).click();
      if (mobile) await page.locator('#mobileBar [data-sheet="sheets"]').tap();
      await page.getByRole('tab', { name: 'Площади', exact: true }).click();
      await page.getByRole('tab', { name: 'Комнаты', exact: true }).click();
      const search = page.getByRole('searchbox', { name: 'Найти комнату на плане' });
      const rows = page.locator('#schedTable tr[data-sched-room]:visible');
      assert.equal(await rows.count(), 11);
      await search.fill('театральный зал');
      assert.equal(await rows.count(), 0);
      assert.match(await page.locator('#schedStatus').textContent(), /не найдено/);
      await search.fill('2 этаж');
      assert.equal(await rows.count(), 6);
      assert.deepEqual(await rows.evaluateAll((rs) => [...new Set(rs.map((r) => r.dataset.schedLevel))]), ['L2']);
      await search.fill('этаж 1 кухня');
      assert.equal(await rows.count(), 1);
      await search.fill('ЭТАЖ   СПАЛЬНЯ');
      assert.equal(await rows.count(), 3);
      assert.equal(await page.locator('#schedTable tfoot').isVisible(), false);
      await search.fill('');
      assert.equal(await rows.count(), 11);
      assert.equal(await page.locator('#schedTable tfoot').isVisible(), true);
      await search.fill('2.03');
      const room = rows.getByRole('button', { name: /Спальня 3/ });
      if (mobile) await room.tap();
      else { await search.press('Tab'); await room.press('Space'); }
      await settleView(page);
      if (!mobile) assert.equal(await page.locator('#roomName').evaluate((input) => document.activeElement === input), true);
      const target = await page.evaluate(async () => {
        const { state } = window.__kepler;
        const { planToScreen } = await import('../../ui/view.js');
        const canvas = document.querySelector('#canvas');
        const selection = state.project.rooms.find((r) => r.id === state.selection?.id);
        if (!selection) return null;
        const center = planToScreen(selection.x + selection.w / 2, selection.y + selection.h / 2);
        return { floor: state.project.activeLevel, name: selection.name, tab: state.propsTab,
          inView: Math.abs(center.x - canvas.clientWidth / 2) < canvas.clientWidth / 4 &&
            Math.abs(center.y - canvas.clientHeight / 2) < canvas.clientHeight / 4,
          sheetOpen: document.body.classList.contains('sheet-props') };
      });
      assert.deepEqual(target, { floor: 'L2', name: 'Спальня 3', tab: 'props', inView: true, sheetOpen: false });
      assert.deepEqual(app.errors, []);
    } finally { await app.close(); }
  });
}

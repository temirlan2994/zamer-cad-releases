// e2e сохранения: автосохранение и перезагрузка, битые данные, история
// отмены при замене проекта, квота localStorage (аудит 2026-11b, П-1…П-6, П-10).
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, openNew, openSample, uploadText } from './helpers.mjs';

const KEY = 'kepler-plan-autosave';

// Записать автосохранение и перезагрузить страницу (свои правки — сначала на диск).
async function reloadWith(page, text) {
  await page.evaluate(async ([key, value]) => {
    const store = await import('./ui/store.js');
    const scope = await import('./ui/storage-scope.js');
    store.flushAutosave();
    scope.setScopedItem(key, value);
  }, [KEY, text]);
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__kepler));
}

// Проект только с ландшафтом (без комнат и границы).
const landscapeOnly = (page) => page.evaluate(async () => {
  const { createProject, serializeProject } = await import('./core/model.js');
  const { createLandscapeObject } = await import('./core/landscape.js');
  const p = createProject('Сад');
  p.site.landscape.objects.push(createLandscapeObject('tree-oak', 1000, 2000));
  return serializeProject(p);
});

describe('сохранение и восстановление', () => {
  let app;
  before(async () => { app = await startApp(); await openNew(app.page); });
  after(async () => { await app?.close(); });

  it('ландшафт без комнат и границы открывается после перезагрузки', async () => {
    const { page } = app;
    await reloadWith(page, await landscapeOnly(page));
    const s = await page.evaluate(() => ({
      name: window.__kepler.state.project.name,
      objects: window.__kepler.state.project.site.landscape.objects.length,
      start: !document.getElementById('startScreen').hidden,
    }));
    assert.equal(s.name, 'Сад');
    assert.equal(s.objects, 1);
    assert.equal(s.start, false, 'стартовое меню не открывается поверх проекта');
  });

  it('«Пример» поверх ландшафта: Ctrl+Z возвращает ландшафт', async () => {
    const { page } = app;
    const s = await page.evaluate(async () => {
      const files = await import('./ui/files.js');
      const store = await import('./ui/store.js');
      const { state } = await import('./ui/state.js');
      files.loadSample();
      const rooms = state.project.rooms.length;
      store.undo();
      return { rooms, objects: state.project.site.landscape.objects.length, name: state.project.name };
    });
    assert.ok(s.rooms > 0);
    assert.equal(s.objects, 1);
    assert.equal(s.name, 'Сад');
  });

  it('битое автосохранение: запуск без ошибок, пустой проект, копия в резерве', async () => {
    const { page } = app;
    const before = app.errors.length;
    const broken = JSON.stringify({ schema: 'kepler-plan/5', name: 'Битый', levels: 'нет' });
    await reloadWith(page, broken);
    await page.waitForSelector('#startScreen:not([hidden])');
    const s = await page.evaluate(async () => {
      const { getScopedItem } = await import('./ui/storage-scope.js');
      return {
        backup: getScopedItem('kepler-plan-autosave-broken'),
        warn: document.getElementById('startWarn').textContent,
        rooms: window.__kepler.state.project.rooms.length,
      };
    });
    assert.equal(s.backup, broken);
    assert.match(s.warn, /не открылся/);
    assert.equal(s.rooms, 0);
    assert.deepEqual(app.errors.slice(before).filter((e) => e.startsWith('pageerror')), []);
  });

  it('битые элементы в автосохранении (null в rooms/items) вычищаются', async () => {
    const { page } = app;
    const text = await page.evaluate(async () => {
      const { createProject, createRoom } = await import('./core/model.js');
      const p = createProject('Мусор');
      p.rooms.push(createRoom('living', 0, 0, 4000, 4000), null);
      p.items.push(null, { kind: 'sofa', x: 'a' });
      p.openings.push(null);
      return JSON.stringify(p);
    });
    await reloadWith(page, text);
    const s = await page.evaluate(() => ({
      name: window.__kepler.state.project.name,
      rooms: window.__kepler.state.project.rooms.length,
      items: window.__kepler.state.project.items.length,
    }));
    assert.deepEqual(s, { name: 'Мусор', rooms: 1, items: 0 });
  });

  it('файл, который не открывается, не трогает текущий проект', async () => {
    const { page } = app;
    await page.evaluate(async () => (await import('./ui/start-menu.js')).closeStartMenu());
    await page.evaluate(async () => (await import('./ui/files.js')).loadSample());
    const before = await page.evaluate(() => window.__kepler.state.project.rooms.length);
    await uploadText(page, '#fileInput', 'bad.kepler.json', JSON.stringify({ schema: 'kepler-plan/5', levels: [{ rooms: 'x' }] }));
    await page.waitForFunction(() => /Не удалось открыть/.test(document.getElementById('toast').textContent));
    const after = await page.evaluate(() => window.__kepler.state.project.rooms.length);
    assert.equal(after, before);
  });

  it('pagehide: правка записывается сразу, без задержки', async () => {
    const { page } = app;
    const saved = await page.evaluate(async () => {
      const store = await import('./ui/store.js');
      const { getScopedItem } = await import('./ui/storage-scope.js');
      const { state } = await import('./ui/state.js');
      store.mutate(() => { state.project.name = 'Перед закрытием'; });
      window.dispatchEvent(new Event('pagehide'));
      return JSON.parse(getScopedItem('kepler-plan-autosave')).name;
    });
    assert.equal(saved, 'Перед закрытием');
  });

  it('история отмены не копирует подложку и снимки без отступов', async () => {
    const { page } = app;
    const s = await page.evaluate(async () => {
      const store = await import('./ui/store.js');
      const { state, history } = await import('./ui/state.js');
      const src = `data:image/png;base64,${'A'.repeat(300000)}`;
      store.mutate(() => { state.project.site.underlay = { src, x: 0, y: 0, mmPerPx: 10, opacity: 0.5, widthPx: 10, heightPx: 10 }; });
      store.mutate(() => { state.project.name = 'С подложкой'; });
      const last = history.undo[history.undo.length - 1].text;
      store.undo();
      store.undo();
      const gone = state.project.site.underlay;
      store.redo();
      return {
        snapLen: last.length, indented: last.includes('\n'),
        undoneUnderlay: gone, restored: state.project.site.underlay?.src === src,
      };
    });
    assert.ok(s.snapLen < 100000, `снимок ${s.snapLen} символов`);
    assert.equal(s.indented, false);
    assert.equal(s.undoneUnderlay, null);
    assert.equal(s.restored, true);
  });

  it('квота localStorage: предупреждение и запись без подложки, подложка — из IndexedDB', async () => {
    const { page } = app;
    const s = await page.evaluate(async () => {
      const store = await import('./ui/store.js');
      const { getScopedItem, scopedKey } = await import('./ui/storage-scope.js');
      const { state } = await import('./ui/state.js');
      const orig = Storage.prototype.setItem;
      const autosaveKey = scopedKey('kepler-plan-autosave');
      Storage.prototype.setItem = function setItem(k, v) {
        if (k === autosaveKey && String(v).length > 200000) throw new DOMException('full', 'QuotaExceededError');
        return orig.call(this, k, v);
      };
      try {
        store.mutate(() => { state.project.name = 'Квота'; });
        store.flushAutosave();
      } finally {
        Storage.prototype.setItem = orig;
      }
      const saved = getScopedItem('kepler-plan-autosave');
      return { name: JSON.parse(saved).name, len: saved.length, src: JSON.parse(saved).site.underlay?.src, toast: document.getElementById('toast').textContent };
    });
    assert.equal(s.name, 'Квота');
    assert.ok(s.len < 200000);
    assert.match(s.src, /^kidb:/);
    assert.match(s.toast, /Мало места/);
    // Перезагрузка: подложка возвращается из IndexedDB.
    await page.waitForTimeout(300);
    await page.reload();
    await page.waitForFunction(() => Boolean(window.__kepler));
    await page.waitForFunction(() => window.__kepler.state.project.site.underlay?.src?.startsWith('data:'));
    assert.equal(await page.evaluate(() => window.__kepler.state.project.name), 'Квота');
  });
});

describe('сохранение: стартовое меню', () => {
  let app;
  before(async () => { app = await startApp(); });
  after(async () => { await app?.close(); });

  it('пустой старт по-прежнему показывает стартовое меню', async () => {
    assert.equal(await app.page.evaluate(() => document.getElementById('startScreen').hidden), false);
    await openSample(app.page);
    assert.deepEqual(app.errors.filter((e) => e.startsWith('pageerror')), []);
  });
});

import {
  after, before, describe, it,
} from 'node:test';
import assert from 'node:assert/strict';
import { openSample, startApp } from './helpers.mjs';

// Подменяем адаптер внешнего Firebase. Проектный код, блокировки, автосохранение
// и версии работают в обычном хранилище с транзакциями и общей для вкладок IndexedDB.
async function useTestAccount(page, currentUid) {
  await page.context().route('**/ui/firebase.js', (route) => route.fulfill({
    contentType: 'text/javascript',
    body: `
      import { createLocalDb } from './localdb.js';
      let db;
      export const initializeFirebase = () => db ??= createLocalDb();
      export const firebaseState = async () => ({ configured: true, user: { uid: ${JSON.stringify(currentUid())} } });
      export const onFirebaseAuthChanged = (listener) => { firebaseState().then(listener); return () => {}; };
      export async function firebaseSignInGoogle() { throw Error('Используется тестовый аккаунт'); }
      export async function firebaseSignOut() { throw Error('Используется тестовый аккаунт'); }
    `,
  }));
}

async function reloadEditor(page) {
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__kepler));
}

async function saveVersion(page, name) {
  await page.fill('#projectName', name);
  await page.press('#projectName', 'Enter');
  await page.click('#projectsBtn');
  await page.click('#prjSave');
  await page.waitForSelector('.prj-row.current .prj-main small:has-text("версий: 1")');
  await page.click('#projectsClose');
}

const readModel = (page) => page.evaluate(() => {
  const { pid, project } = window.__kepler.state;
  return { pid, name: project.name, rooms: project.rooms.map((r) => r.id) };
});

const readEditor = (page, pid) => page.evaluate(async (id) => {
  const { db, root } = await (await import('./ui/cloud.js')).getBackend();
  const { readEditLease, leaseFence } = await import('./core/edit-lease.js');
  return leaseFence(await readEditLease(db, root, id));
}, pid);

describe('выбор проектов при запуске', () => {
  let app;
  before(async () => { app = await startApp(); });
  after(async () => { await app?.close(); });

  it('у нового пользователя примеры показывают снимки планов', async () => {
    const { page } = app;
    assert.equal(await page.isHidden('#startRecentSection'), true);
    assert.equal(await page.$$eval('#startTemplates .startup-project-card', (nodes) => nodes.length), 4);
    const images = page.locator('#startTemplates .project-preview-image');
    assert.equal(await images.count(), 4);
    for (const image of await images.all()) {
      await image.scrollIntoViewIfNeeded();
      await image.evaluate((node) => node.decode());
      assert.equal(await image.evaluate((node) => node.naturalWidth), 640);
    }
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
    await page.waitForSelector(`${card} .startup-project-preview img`);
    const preview = await page.$eval(`${card} .startup-project-preview img`, (image) => ({
      complete: image.complete,
      height: image.naturalHeight,
      src: image.getAttribute('src'),
      width: image.naturalWidth,
    }));
    assert.match(preview.src, /^data:image\/(?:webp|jpeg);base64,/);
    assert.equal(preview.complete, true);
    assert.ok(preview.width > 0 && preview.height > 0);
    assert.equal(await page.$eval(card, (node) => getComputedStyle(node).userSelect), 'none',
      'двойной клик по карточке не выделяет её текст');
    await page.click(card);
    await page.waitForSelector('#startScreen', { state: 'hidden' });
    assert.equal(await page.evaluate(() => window.__kepler.state.project.name), name);
    assert.deepEqual(app.errors, []);
  });

  it('старую схематичную карточку сама заменяет настоящим снимком без проекта-резерва', async () => {
    const { page } = app;
    const pid = await page.evaluate(async () => {
      const { createProjectPreview } = await import('./core/project-preview.js');
      const { getLocalBackend } = await import('./ui/cloud.js');
      const target = await getLocalBackend();
      const id = window.__kepler.state.pid;
      await target.db.doc(`${target.root}/${id}`).update({
        preview: createProjectPreview(window.__kepler.state.project),
      });
      return id;
    });
    await page.click('#menuBtn');
    const card = `#startRecentProjects .startup-project-card[data-pid="${pid}"]`;
    await page.waitForSelector(`${card} .startup-project-preview img`);
    const stored = await page.evaluate(async (id) => {
      const { getLocalBackend } = await import('./ui/cloud.js');
      const target = await getLocalBackend();
      const projects = await target.db.collection(target.root).get();
      const meta = await target.db.doc(`${target.root}/${id}`).get();
      return { count: projects.docs.length, preview: meta.data()?.preview };
    }, pid);
    assert.equal(stored.count, 1, 'миграция не создаёт копию «резерв»');
    assert.equal(stored.preview.v, 2);
    assert.match(stored.preview.image, /^data:image\/(?:webp|jpeg);base64,/);
    await page.click(card);
    await page.waitForSelector('#startScreen', { state: 'hidden' });
    assert.deepEqual(app.errors, []);
  });

  it('список проектов открывается из редактора, создание нового проекта требует подтверждения', async () => {
    const { page } = app;
    const before = await page.evaluate(() => window.__kepler.state.project.name);
    await page.click('#menuBtn');
    await page.waitForSelector('#startContinue:visible');
    assert.equal(await page.textContent('#startContinue span'), before);
    await page.click('#startNew');
    await page.waitForSelector('#warnCancel:visible');
    await page.click('#warnCancel');
    await page.click('#startContinue');
    await page.waitForSelector('#startScreen', { state: 'hidden' });
    assert.equal(await page.evaluate(() => window.__kepler.state.project.name), before);
  });
});

it('F5 открывает сохранённый проект владельца, а явный выбор проектов и вход другой учётки открывают список', async () => {
  const app = await startApp({ query: 'authGate=1' });
  const { page } = app;
  try {
    assert.ok(await page.isVisible('#startGoogleSignIn'));
    let uid = 'architect-a';
    await useTestAccount(page, () => uid);
    await reloadEditor(page);
    assert.ok(await page.isVisible('#startProjectsView'), 'при первом входе предлагают выбор');
    await openSample(page);
    await saveVersion(page, 'Мой эскиз');
    const name = 'Эскиз после правки';
    await page.fill('#projectName', name);
    await page.press('#projectName', 'Enter');
    const original = await readModel(page);
    assert.ok(original.pid && original.rooms.length);
    assert.equal(original.name, name);
    const editor = await readEditor(page, original.pid);
    assert.ok(editor?.editorSession && editor.editorEpoch > 0);
    await reloadEditor(page);
    assert.ok(await page.isHidden('#startScreen'), 'F5 на плане открывает редактор сразу');
    assert.deepEqual(await readModel(page), original);
    await page.waitForFunction((pid) => window.__kepler.state.editLeasePid === pid, original.pid);
    assert.deepEqual(await readEditor(page, original.pid), editor, 'F5 продлевает уже выданное право редактирования');
    assert.ok(await page.isHidden('#editLockScreen'));
    assert.equal(await page.locator('.app').getAttribute('inert'), null);

    await page.click('#menuBtn');
    assert.ok(await page.isVisible('#startProjectsView'));
    await reloadEditor(page);
    assert.ok(await page.isVisible('#startProjectsView'), 'F5 в окне выбора сохраняет это окно');
    await page.click('#startContinue');
    await page.waitForSelector('#startScreen', { state: 'hidden' });

    uid = 'architect-b';
    await reloadEditor(page);
    assert.ok(await page.isVisible('#startProjectsView'));
    assert.ok(await page.isHidden('#startContinue'), 'чужая активная модель недоступна');
    assert.equal((await readModel(page)).pid, null);
    assert.equal(await page.locator('#startRecentProjects .startup-project-card').count(), 0);
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

it('F5 при подтверждённом редакторе на другом устройстве показывает блокировку и позволяет вернуться в проекты', async () => {
  const app = await startApp({ query: 'authGate=1' });
  const { page } = app;
  try {
    await useTestAccount(page, () => 'architect');
    await reloadEditor(page);
    await openSample(page);
    await saveVersion(page, 'Совместный эскиз');
    const { pid } = await readModel(page);
    const remote = await page.evaluate(async (id) => {
      const { db, root } = await (await import('./ui/cloud.js')).getBackend();
      const { takeoverEditLease, leaseFence } = await import('./core/edit-lease.js');
      const identity = { sessionId: 'remote-tab', deviceId: 'remote-device', deviceName: 'Второй компьютер' };
      const { lease } = await takeoverEditLease(db, root, id, identity, { force: true });
      return leaseFence(lease);
    }, pid);
    await page.reload();
    await page.waitForSelector('#editLockScreen:not([hidden])');
    assert.match(await page.locator('#editLockDevice').textContent(), /Второй компьютер/);
    assert.ok(await page.isHidden('#startScreen'));
    assert.notEqual(await page.locator('.app').getAttribute('inert'), null);
    assert.deepEqual(await readEditor(page, pid), remote);
    await page.click('#editLockProjects');
    await page.waitForSelector('#startProjectsView');
    assert.ok(await page.isHidden('#editLockScreen'));
    assert.deepEqual(await readEditor(page, pid), remote, 'возврат к списку не забирает чужую блокировку');
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

it('вкладки с разными проектами одного аккаунта восстанавливают каждая свой план', async () => {
  const app = await startApp({ query: 'authGate=1' });
  const first = app.page;
  try {
    await useTestAccount(first, () => 'architect');
    await reloadEditor(first);
    await openSample(first);
    await saveVersion(first, 'Первый проект');
    const one = await readModel(first);
    const secondOpened = first.context().waitForEvent('page');
    await first.evaluate(() => window.open(location.href, '_blank', 'noopener'));
    const second = await secondOpened;
    await second.click('#startTemplates [data-template="two-storey"]');
    await saveVersion(second, 'Второй проект');
    const two = await readModel(second);
    assert.ok(one.pid && two.pid && one.pid !== two.pid);
    await second.waitForFunction(async (name) => {
      const { getScopedItem } = await import('./ui/storage-scope.js');
      return JSON.parse(getScopedItem('kepler-plan-autosave'))?.name === name;
    }, two.name);
    await reloadEditor(first);
    assert.ok(await first.isHidden('#startScreen'));
    assert.deepEqual(await readModel(first), one);
    await first.waitForFunction((pid) => window.__kepler.state.editLeasePid === pid, one.pid);
    const stored = await first.evaluate(async () => {
      const { getScopedItem } = await import('./ui/storage-scope.js');
      const { flushAutosave, PID_KEY } = await import('./ui/store.js');
      flushAutosave();
      return { pid: getScopedItem(PID_KEY), name: JSON.parse(getScopedItem('kepler-plan-autosave')).name };
    });
    assert.deepEqual(stored, { pid: two.pid, name: two.name });
    await reloadEditor(second);
    assert.deepEqual(await readModel(second), two);
    assert.ok(await second.isHidden('#startScreen'));
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

describe('первый чертёж', () => {
  it('обе команды включают инструмент, а первая отдельная стена убирает приглашение и сохраняется', async () => {
    const app = await startApp();
    try {
      const { page } = app;
      await page.click('#startNew');
      await page.click('#firstDrawActions [data-first-tool="boundRoomBtn"]');
      await page.locator('#firstDrawActions').waitFor({ state: 'hidden' });
      assert.equal(await page.isVisible('#roomCards'), true);
      await page.click('#selectToolBtn');
      await page.click('#firstDrawActions [data-first-tool="wallToolBtn"]');
      const rect = await page.locator('#canvas').boundingBox();
      await page.mouse.click(rect.x + rect.width * .35, rect.y + rect.height * .5);
      await page.mouse.click(rect.x + rect.width * .60, rect.y + rect.height * .5);
      await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(() => window.__kepler.state.project.walls.length), 1);
      await page.locator('#firstDrawActions').waitFor({ state: 'hidden' });
      await page.click('#menuBtn');
      assert.equal(await page.isVisible('#startContinue'), true);
    } finally { await app.close(); }
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

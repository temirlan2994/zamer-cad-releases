import assert from 'node:assert/strict';
import { it } from 'node:test';
import { readFile } from 'node:fs/promises';
import { startApp, openNew } from './helpers.mjs';

for (const mobile of [false, true]) it(`концепция: варианты, бюджет, профиль, согласование и Undo · ${mobile ? 'телефон' : 'компьютер'}`, async () => {
  const app = await startApp({ mobile, width: 1440, height: 950 }); const { page } = app;
  const press = (selector) => mobile ? page.tap(selector) : page.click(selector);
  const tab = async (id) => { await press(`[data-concept-tab="${id}"]`); await page.waitForSelector('#conceptContent[aria-busy="false"]'); };
  try {
    await openNew(page);
    await page.evaluate(async () => {
      const { createRoom } = await import('./core/model.js'); const { mutate } = await import('./ui/store.js');
      mutate(() => { const p = window.__kepler.state.project; const room = createRoom('living', 0, 0, 5000, 4000); room.id = 'concept-room'; p.rooms.push(room); p.envelope.zeroAboveGround = 200; p.envelope.groundReferenceZ = 0; });
    });
    const rollback = await page.evaluate(async () => {
      const { mutate, snapshot } = await import('./ui/store.js'); const { history } = await import('./ui/state.js');
      const before = snapshot(), count = history.undo.length;
      try { mutate(() => { window.__kepler.state.project.rooms[0].w = 9000; throw new Error('Отказ операции'); }); } catch { /* ожидаемый отказ */ }
      return { same: snapshot() === before, historySame: history.undo.length === count };
    });
    assert.deepEqual(rollback, { same: true, historySame: true });
    await press('#conceptBtn'); await tab('variants');
    await page.fill('[data-concept-form="variant"] [name="name"]', 'Вариант Б'); await press('[data-concept-form="variant"] button[type="submit"]');
    await page.waitForSelector('.concept-variant.active');
    assert.equal(await page.locator('.concept-variant').count(), 2);
    const a = await page.evaluate(() => window.__kepler.state.project.variants[0].id);
    await press('#conceptClose'); await page.evaluate(() => window.__kepler.selectRoom('concept-room'));
    if (mobile) await page.tap('#mobileBar [data-sheet="props"]');
    await page.fill('#roomW', '7000'); await page.locator('#roomW').blur();
    await press('#conceptBtn'); await tab('variants');
    assert.match(await page.locator('.concept-variant.active').innerText(), /28/);
    await press(`[data-concept-action="activate"][data-id="${a}"]`);
    await page.waitForFunction(() => window.__kepler.state.project.rooms[0].w === 5000);
    await tab('budget');
    await page.fill('[name="region"]', 'Бишкек'); await page.fill('[name="source"]', 'Тестовое предложение подрядчика'); await page.fill('[name="date"]', '2026-11-27');
    for (const input of await page.locator('[name^="rate-"]').all()) await input.fill('1000');
    await press('[data-concept-form="budget"] button[type="submit"]');
    await page.waitForSelector('#conceptContent[aria-busy="false"]');
    assert.match(await page.locator('.concept-summary').innerText(), /Итого/);
    await tab('rules'); await page.selectOption('[name="profile"]', 'KG'); await press('[data-concept-form="rules"] button[type="submit"]');
    await page.waitForSelector('#conceptContent[aria-busy="false"]');
    assert.match(await page.locator('#conceptContent').innerText(), /Применимость нормативов Кыргызстана не подтверждена/);
    await tab('review'); await press('[data-concept-action="snapshot"]'); await page.waitForSelector('[data-concept-form="decision"]');
    await page.fill('[data-concept-form="decision"] [name="author"]', 'Заказчик'); await page.selectOption('[data-concept-form="decision"] [name="action"]', 'approve'); await press('[data-concept-form="decision"] button[type="submit"]');
    await page.waitForSelector('#conceptContent[aria-busy="false"]'); assert.equal(await page.locator('#conceptContent > .concept-badge').innerText(), 'Согласовано');
    await tab('budget'); await page.fill('[name="rate-walls"]', '2000'); await press('[data-concept-form="budget"] button[type="submit"]');
    await tab('review'); assert.match(await page.locator('#conceptContent').innerText(), /После прежнего согласования модель изменилась/);
    await press('[data-concept-action="undo"]'); await page.waitForSelector('#conceptContent[aria-busy="false"]');
    assert.equal(await page.locator('#conceptContent > .concept-badge').innerText(), 'Согласовано');
    await page.screenshot({ path: `/tmp/kepler-concept-${mobile ? 'mobile' : 'desktop'}.png` });
    await press('#conceptClose');
    const before = await page.evaluate(async () => (await import('./ui/store.js')).snapshot());
    await press('#conceptBtn'); await page.keyboard.press('Delete'); await press('#conceptClose');
    assert.equal(await page.evaluate(async () => (await import('./ui/store.js')).snapshot()), before, 'горячие клавиши не меняют дом под диалогом');
    await page.evaluate(async () => { await (await import('./ui/store.js')).flushAutosave(); });
    await page.reload(); await page.waitForFunction(() => window.__kepler?.state.project?.concept?.decisions?.length === 1);
    await press('#conceptBtn'); await tab('review');
    assert.equal(await page.locator('#conceptContent > .concept-badge').innerText(), 'Согласовано');
    await tab('variants'); assert.equal(await page.locator('.concept-variant').count(), 2);
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

it('клиентский HTML самодостаточен, защищает данные от исполнения и возвращает ответ в исходный проект', async () => {
  const app = await startApp({ width: 1440, height: 950 }); const { page } = app;
  try {
    await openNew(page);
    await page.evaluate(async () => {
      const { createRoom } = await import('./core/model.js'); const { mutate } = await import('./ui/store.js');
      mutate(() => { const p = window.__kepler.state.project; p.rooms.push(createRoom('living',0,0,5000,4000)); p.name = '</script><script>window.reviewInjected=true</script>'; });
    });
    await page.click('#conceptBtn'); await page.click('[data-concept-tab="review"]'); await page.waitForSelector('[data-concept-action="snapshot"]');
    await page.click('[data-concept-action="snapshot"]'); await page.waitForSelector('[data-concept-action="review-html"]');
    const downloadPromise = page.waitForEvent('download'); await page.click('[data-concept-action="review-html"]');
    const download = await downloadPromise; const html = await readFile(await download.path(), 'utf8');
    assert.ok(html.includes('importmap'));
    const context = await page.context().browser().newContext({ viewport: { width: 1200, height: 850 } });
    try {
      const viewer = await context.newPage(); const errors = []; viewer.on('pageerror', (error) => errors.push(error.message));
      await viewer.route('**/offline-review.html', (route) => route.fulfill({ contentType: 'text/html', body: html }));
      await viewer.goto(new URL('offline-review.html', page.url()).href);
      await viewer.waitForSelector('#reviewWorkspace:not([hidden])'); await context.setOffline(true);
      assert.equal(await viewer.evaluate(() => window.reviewInjected), undefined);
      assert.match(await viewer.locator('#reviewTitle').innerText(), /window.reviewInjected/);
      await viewer.click('#v3Walk'); assert.equal(await viewer.locator('body').evaluate((body)=>body.classList.contains('v3-walk-choosing')),true);
      const walkBox=await viewer.locator('#reviewCanvas').boundingBox();
      for (const y of [.65,.8,.5,.9]) {
        for (const x of [.2,.8,.35,.65,.5]) {
          if (await viewer.locator('body').evaluate((body)=>body.classList.contains('v3-walking'))) break;
          await viewer.mouse.click(walkBox.x+walkBox.width*x,walkBox.y+walkBox.height*y);
        }
        if (await viewer.locator('body').evaluate((body)=>body.classList.contains('v3-walking'))) break;
      }
      assert.equal(await viewer.locator('#v3WalkHud').isVisible(),true);
      assert.equal(await viewer.locator('.review-feedback').evaluate((element)=>element.inert),true);
      await viewer.keyboard.down('KeyW');await viewer.waitForTimeout(200);await viewer.keyboard.up('KeyW');await viewer.keyboard.press('Escape');
      assert.equal(await viewer.locator('#v3WalkHud').isVisible(),false);
      assert.equal(await viewer.locator('.review-feedback').evaluate((element)=>element.inert),false);
      await viewer.click('#reviewPlacePin'); const box = await viewer.locator('#reviewCanvas').boundingBox();
      await viewer.mouse.click(box.x+box.width/2, box.y+box.height/2);
      assert.notEqual(await viewer.locator('#reviewPointDescription').innerText(), 'Место не указано');
      await viewer.fill('[name="author"]', 'Заказчик'); await viewer.fill('[name="message"]', 'Изменить вход');
      const responsePromise = viewer.waitForEvent('download'); await viewer.click('#reviewSend');
      const response = await responsePromise; const text = await readFile(await response.path(), 'utf8');
      const chooserPromise = page.waitForEvent('filechooser'); await page.click('[data-concept-action="import-response"]');
      const chooser = await chooserPromise; await chooser.setFiles({ name: 'response.json', mimeType: 'application/json', buffer: Buffer.from(text) });
      await page.waitForFunction(() => window.__kepler.state.project.concept.decisions.length === 1);
      await page.waitForSelector('#conceptContent[aria-busy="false"]');
      assert.match(await page.locator('#conceptContent').innerText(), /Изменить вход/);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

it('конструктивные размеры применяются атомарно; кнопки выдачи скачивают полный проверяемый комплект', async () => {
  const app = await startApp({ width: 1440, height: 950 }); const { page } = app;
  try {
    await openNew(page);
    await page.evaluate(async () => {
      const { createRoom } = await import('./core/model.js'); const { mutate } = await import('./ui/store.js');
      mutate(() => { window.__kepler.state.project.rooms.push(createRoom('living',0,0,5000,4000)); });
    });
    await page.click('#conceptBtn'); await page.click('[data-concept-tab="construction"]');
    await page.waitForSelector('[data-concept-form="construction"]');
    await page.selectOption('[name="system"]', 'masonry'); await page.fill('[name="material-0"]','Блок');
    await page.fill('[name="thickness-0"]','900'); await page.check('[name="applyThickness"]');
    const before = await page.evaluate(async ()=>(await import('./ui/store.js')).snapshot());
    await page.click('[data-concept-form="construction"] button[type="submit"]');
    await page.waitForFunction(()=>document.getElementById('toast').textContent.includes('сумма слоёв'));
    assert.equal(await page.evaluate(async ()=>(await import('./ui/store.js')).snapshot()),before);
    await page.fill('[name="thickness-0"]','400'); await page.click('[data-concept-form="construction"] button[type="submit"]');
    await page.waitForFunction(()=>window.__kepler.state.project.settings.exterior===400);
    await page.click('[data-concept-tab="handoff"]'); await page.waitForSelector('[data-concept-action="handoff"]:not([disabled])');
    const zipPromise=page.waitForEvent('download');await page.click('[data-concept-action="handoff"]');const zip=await zipPromise;
    const { execFileSync }=await import('node:child_process');const path=await zip.path();
    const manifest=JSON.parse(execFileSync('unzip',['-p',path,'manifest.json'],{encoding:'utf8'}));
    assert.equal(manifest.schema,'kepler-handoff/1'); assert.equal(manifest.checks.revitRuntime,'external_verification_required');
    const { createHash }=await import('node:crypto');
    for(const entry of manifest.files){const bytes=execFileSync('unzip',['-p',path,entry.name]);assert.equal(bytes.length,entry.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256);}
    const model=JSON.parse(execFileSync('unzip',['-p',path,'model.export.json'],{encoding:'utf8'}));
    assert.ok(model.concept.project_id);assert.equal(model.concept.geometry_complete,true);assert.ok(model.concept_geometry.length>0);
    await page.click('#conceptClose'); const jsonPromise=page.waitForEvent('download');
    await page.click('#exportBtn'); await page.click('[data-export="json"]');const jsonFile=await jsonPromise;
    const json=JSON.parse(await readFile(await jsonFile.path(),'utf8'));assert.equal(json.concept.project_id,model.concept.project_id);
    assert.equal(json.concept.digest,manifest.digest);assert.deepEqual(app.errors,[]);
  } finally { await app.close(); }
});

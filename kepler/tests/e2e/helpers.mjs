// Общие помощники e2e-тестов Kepler Plan (Playwright + node:test).
import { chromium } from 'playwright';
import { createServer, listen } from '../../scripts/serve.mjs';

// Поднимает приложение: сервер на свободном порту + Chromium.
// Страница открывается с ?debug=1 — тестам нужен window.__kepler
// (без флага отладочный API не публикуется).
// mobile: true — телефон (390×844, касания, isMobile).
// query — дополнительные параметры адреса (например, 'walls=v2').
// issueGroups: 'all' | [id…] — включённые группы замечаний (localStorage
// kepler-issues-groups до загрузки; по умолчанию — умолчания приложения).
export const ALL_ISSUE_GROUPS = ['access', 'norms', 'light', 'insolation', 'furniture', 'geometry'];
export async function startApp({ width = 1280, height = 820, debug = true, mobile = false, query = '', issueGroups = null } = {}) {
  const server = createServer();
  const port = await listen(server);
  // UTF-8-локаль: иначе Chromium на Linux с LANG=C/POSIX сохраняет файлы
  // с кириллицей в имени как «download» (имя нельзя перевести в кодировку ФС).
  const browser = await chromium.launch({ env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' } });
  const page = mobile
    ? await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })).newPage()
    : await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  if (issueGroups) {
    const ids = issueGroups === 'all' ? ALL_ISSUE_GROUPS : issueGroups;
    // Только при первой загрузке: перезагрузка в тесте видит то, что сохранило приложение.
    await page.addInitScript((list) => {
      if (!sessionStorage.getItem('kepler-test-groups')) {
        localStorage.setItem('kepler-issues-groups', JSON.stringify(list));
        sessionStorage.setItem('kepler-test-groups', '1');
      }
    }, ids);
  }
  const params = [debug ? 'debug=1' : '', query].filter(Boolean).join('&');
  await page.goto(`http://127.0.0.1:${port}/index.html${params ? `?${params}` : ''}`);
  if (debug) await page.waitForFunction(() => Boolean(window.__kepler));
  else await page.waitForSelector('#startScreen:not([hidden])');
  return {
    page,
    errors,
    async close() { await browser.close(); await new Promise((r) => server.close(r)); },
  };
}

// Стартовое меню → «Загрузить пример» / «Новый проект».
export async function openSample(page) {
  await page.click('#startSample');
  await page.waitForFunction(() => window.__kepler.state.project.rooms.length > 0);
}
// Мебель реагирует на мышь только при масштабе 1:45 и ближе (core/hit-stack.js):
// приближаем вид и ставим центр мебели в центр холста (x, y предмета — его центр).
export async function zoomToItems(page, scale = 0.12, ids = null) {
  await page.evaluate(async ([target, only]) => {
    const v = await import('./ui/view.js');
    const st = window.__kepler.state;
    const items = st.project.items.filter((i) => !only || only.includes(i.id));
    const cx = items.reduce((a, i) => a + i.x, 0) / Math.max(1, items.length);
    const cy = items.reduce((a, i) => a + i.y, 0) / Math.max(1, items.length);
    st.view.scale = Math.max(st.view.scale, target);
    const s = v.planToScreen(cx, cy);
    const c = document.getElementById('canvas');
    st.view.panX += c.clientWidth / 2 - s.x;
    st.view.panY += c.clientHeight / 2 - s.y;
    window.__kepler.requestDraw?.();
  }, [scale, ids]);
}

export async function openNew(page) {
  await page.click('#startNew');
  await page.waitForFunction(() => document.getElementById('startScreen').hidden);
}

// Вызов отладочного API в странице.
export function k(page, fn, arg) {
  return page.evaluate(fn, arg);
}

// Мировые координаты → клиентские (для mouse.click).
export async function worldToClient(page, x, y) {
  const box = await (await page.$('#canvas')).boundingBox();
  const s = await page.evaluate(([wx, wy]) => window.__kepler.worldToScreen(wx, wy), [x, y]);
  return { x: box.x + s.x, y: box.y + s.y };
}

export async function clickWorld(page, x, y) {
  const p = await worldToClient(page, x, y);
  await page.mouse.click(p.x, p.y);
}

// Перетаскивание (HTML5 DnD) комнаты/мебели из панели на холст: в центр
// или в точку at (координаты относительно холста, пиксели).
export async function dropOnCanvas(page, mime, value, at = null) {
  await page.evaluate(([m, v, p]) => {
    const c = document.getElementById('canvas');
    const r = c.getBoundingClientRect();
    const dt = new DataTransfer();
    dt.setData(m, v);
    const x = r.left + (p ? p.x : r.width / 2);
    const y = r.top + (p ? p.y : r.height / 2);
    const opts = { clientX: x, clientY: y, dataTransfer: dt, bubbles: true, cancelable: true };
    c.dispatchEvent(new DragEvent('dragover', opts));
    c.dispatchEvent(new DragEvent('drop', opts));
  }, [mime, value, at]);
}

// Загрузка текстового файла (DXF/JSON) в скрытый input без файловой системы.
export async function uploadText(page, selector, name, text) {
  await page.setInputFiles(selector, { name, mimeType: 'application/octet-stream', buffer: Buffer.from(text) });
}

// ---- Генераторы тестовых DXF ----
const pair = (...kv) => kv.map(String);

export function dxfSurveyWithOutlier({ points = 40, units = 6 } = {}) {
  const L = pair(0, 'SECTION', 2, 'HEADER', 9, '$INSUNITS', 70, units, 0, 'ENDSEC', 0, 'SECTION', 2, 'ENTITIES');
  for (let i = 0; i < points; i += 1) {
    const x = 3526400 + (i % 8) * 4;
    const y = 4957300 + Math.floor(i / 8) * 5;
    L.push(...pair(0, 'POINT', 10, x, 20, y));
  }
  L.push(...pair(0, 'TEXT', 10, 3526405, 20, 4957305, 40, 1.5, 1, 'H=12.3'));
  L.push(...pair(0, 'LWPOLYLINE', 90, 4, 70, 1, 10, 3526402, 20, 4957302, 10, 3526428, 20, 4957302, 10, 3526428, 20, 4957322, 10, 3526402, 20, 4957322));
  L.push(...pair(0, 'POINT', 10, 0, 20, 0)); // далёкий выброс
  L.push(...pair(0, 'ENDSEC', 0, 'EOF'));
  return L.join('\n');
}

export function dxfWithBlocks() {
  return pair(
    0, 'SECTION', 2, 'BLOCKS',
    0, 'BLOCK', 2, 'TREE', 10, 0, 20, 0,
    0, 'CIRCLE', 10, 0, 20, 0, 40, 2,
    0, 'LINE', 10, -2, 20, 0, 11, 2, 21, 0,
    0, 'ENDBLK',
    0, 'ENDSEC',
    0, 'SECTION', 2, 'ENTITIES',
    0, 'INSERT', 2, 'TREE', 10, 10, 20, 10,
    0, 'INSERT', 2, 'TREE', 10, 30, 20, 25, 41, 2, 42, 2, 50, 45,
    0, 'LWPOLYLINE', 90, 4, 70, 1, 10, 0, 20, 0, 10, 40, 20, 0, 10, 40, 20, 30, 10, 0, 20, 30,
    0, 'ENDSEC', 0, 'EOF',
  ).join('\n');
}

export function dxfProxyOnly() {
  const L = pair(0, 'SECTION', 2, 'OBJECTS');
  for (let i = 0; i < 30; i += 1) L.push(...pair(0, 'ACAD_PROXY_OBJECT', 90, 499));
  L.push(...pair(0, 'ENDSEC', 0, 'SECTION', 2, 'ENTITIES', 0, 'LINE', 10, 0, 20, 0, 11, 1, 21, 0, 0, 'ENDSEC', 0, 'EOF'));
  return L.join('\n');
}

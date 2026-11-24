// Установка на телефон и обновление PWA. Кэшируются только статические файлы;
// проекты, Firebase и Google-сессия продолжают жить в своих хранилищах.

import { el, toast } from './dom.js';

let installPrompt = null;
let installedThisSession = false;
let registration = null;
let lastUpdateCheck = 0;
let controllerSeen = false;
let updateReady = false;
let reloadPending = false;
let reloading = false;

const displayStandalone = () => globalThis.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
const ios = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const mobileViewport = () => globalThis.matchMedia?.('(max-width: 760px)').matches || /Android|Mobile/.test(navigator.userAgent);

function syncInstallButtons() {
  const installed = installedThisSession || displayStandalone();
  const availableHere = Boolean(installPrompt || ios() || mobileViewport());
  const show = !installed && availableHere;
  for (const id of ['startInstallBtn', 'mobileInstallBtn']) {
    const button = el(id);
    if (button) button.hidden = !show;
  }
  const projectsButton = el('startProjectsInstallBtn');
  if (!projectsButton) return;
  projectsButton.hidden = !(installed || availableHere);
  projectsButton.disabled = installed;
  projectsButton.dataset.installed = String(installed);
  const mark = projectsButton.querySelector('.start-install-mark');
  const title = projectsButton.querySelector('b');
  const note = projectsButton.querySelector('small');
  if (mark) mark.textContent = installed ? '✓' : '⇩';
  if (title) title.textContent = installed ? 'Приложение уже установлено' : 'Установить приложение';
  if (note) note.textContent = installed
    ? 'открыто с главного экрана · обновляется автоматически'
    : 'добавить kep•ler 3D на главный экран телефона';
}

function closeInstallHelp() {
  const screen = el('installHelpScreen');
  if (screen) screen.hidden = true;
}

function showInstallHelp() {
  const steps = ios()
    ? ['Откройте этот сайт в Safari.', 'Нажмите «Поделиться» внизу экрана.', 'Выберите «На экран Домой».', 'Нажмите «Добавить».']
    : ['Откройте меню браузера (⋮).', 'Выберите «Установить приложение» или «Добавить на главный экран».', 'Подтвердите установку.'];
  const title = el('installHelpTitle');
  const text = el('installHelpText');
  const list = el('installHelpSteps');
  if (title) title.textContent = ios() ? 'Установить на iPhone или iPad' : 'Установить на телефон';
  if (text) text.textContent = ios()
    ? 'Apple разрешает установку веб-приложений через Safari:'
    : 'Если системное окно не появилось, установите приложение через меню браузера:';
  if (list) list.replaceChildren(...steps.map((step) => {
    const item = document.createElement('li');
    item.textContent = step;
    return item;
  }));
  const screen = el('installHelpScreen');
  if (screen) screen.hidden = false;
  el('installHelpClose')?.focus();
}

export async function requestInstall() {
  if (displayStandalone() || installedThisSession) {
    toast('kep•ler 3D уже установлено');
    syncInstallButtons();
    return false;
  }
  if (!installPrompt) {
    showInstallHelp();
    return false;
  }
  const prompt = installPrompt;
  installPrompt = null;
  await prompt.prompt();
  const choice = await prompt.userChoice;
  if (choice?.outcome === 'accepted') {
    installedThisSession = true;
    toast('kep•ler 3D установлено');
  }
  syncInstallButtons();
  return choice?.outcome === 'accepted';
}

function warmOfflineCopy(worker = registration?.active) {
  if (!worker) return;
  const base = new URL('./', location.href).href;
  const urls = [base, new URL('./index.html', base).href, ...performance.getEntriesByType('resource').map((entry) => entry.name)];
  worker.postMessage({ type: 'CACHE_URLS', urls });
}

function announceWaitingUpdate() {
  if (!registration?.waiting || updateReady) return;
  updateReady = true;
  toast('Новая версия загружена · применится при следующем открытии', true);
}

function activateWaitingUpdate() {
  const worker = registration?.waiting;
  if (!worker) return false;
  // Worker дополнительно проверит все вкладки приложения и не переключит
  // сборку, пока хотя бы в одной из них продолжают работать.
  worker.postMessage({ type: 'SKIP_WAITING' });
  return true;
}

function reloadForUpdate() {
  if (reloading) return;
  reloading = true;
  location.reload();
}

async function checkForUpdate(force = false) {
  if (!registration || !navigator.onLine) return;
  const now = Date.now();
  if (!force && now - lastUpdateCheck < 5 * 60 * 1000) return;
  lastUpdateCheck = now;
  try {
    await registration.update();
    announceWaitingUpdate();
    warmOfflineCopy(registration.active);
  } catch (error) {
    console.info('Проверка обновления PWA отложена:', error);
  }
}

async function registerWorker() {
  if (document.documentElement.hasAttribute('data-kepler-preview')) return;
  const query = new URLSearchParams(location.search);
  if (query.has('debug') && !query.has('pwa')) return; // остальные e2e не устанавливают сотни файлов
  if (globalThis.claude?.use || !('serviceWorker' in navigator) || !globalThis.isSecureContext) return;
  controllerSeen = Boolean(navigator.serviceWorker.controller);
  try {
    const version = globalThis.KEPLER_PWA?.version || 'source';
    const workerUrl = new URL('./sw.js', location.href);
    workerUrl.searchParams.set('v', version);
    registration = await navigator.serviceWorker.register(workerUrl.href, { scope: './', updateViaCache: 'none' });
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) announceWaitingUpdate();
      });
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!controllerSeen) { controllerSeen = true; warmOfflineCopy(navigator.serviceWorker.controller); return; }
      updateReady = false;
      reloadPending = true;
      // Обычно controller меняется, пока приложение скрыто. Если пользователь
      // успел вернуться в этот короткий момент, сразу выравниваем JS и worker.
      if (document.visibilityState === 'visible') reloadForUpdate();
    });
    await checkForUpdate(true);
    const ready = await navigator.serviceWorker.ready;
    warmOfflineCopy(ready.active);
  } catch (error) {
    console.info('PWA пока недоступно:', error);
  }
}

export function bindPwa() {
  syncInstallButtons();
  for (const id of ['startInstallBtn', 'startProjectsInstallBtn', 'mobileInstallBtn']) el(id)?.addEventListener('click', requestInstall);
  el('installHelpClose')?.addEventListener('click', closeInstallHelp);
  el('installHelpScreen')?.addEventListener('click', (event) => {
    if (event.target === event.currentTarget) closeInstallHelp();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || el('installHelpScreen')?.hidden !== false) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    closeInstallHelp();
  }, true);
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event;
    syncInstallButtons();
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    installedThisSession = true;
    syncInstallButtons();
    toast('kep•ler 3D установлено на телефон');
  });
  globalThis.matchMedia?.('(display-mode: standalone)').addEventListener?.('change', syncInstallButtons);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      if (updateReady || registration?.waiting) activateWaitingUpdate();
      return;
    }
    if (reloadPending && !reloading) {
      reloadForUpdate();
      return;
    }
    checkForUpdate();
  });
  window.addEventListener('online', () => checkForUpdate(true));
  window.addEventListener('load', () => warmOfflineCopy(), { once: true });
  setInterval(() => checkForUpdate(), 60 * 60 * 1000);
  registerWorker();
}

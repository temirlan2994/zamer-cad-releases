// Панель «Проекты»: локальные версии для гостя и личное облако после
// входа через Google/Firebase (или capability Claude в артефакте).
// Облачный draft сохраняется отдельно от ручных версий.

import { serializeProject } from '../core/model.js';
import { projectPreviewSvg } from '../core/project-preview.js';
import {
  deleteProject, listProjects, loadShared, loadVersion, newId, publishProject,
  saveDraft, saveVersion, unpublishProject, watchProjects, watchShared,
} from '../core/storage.js';
import { el, escapeHtml, refs, toast } from './dom.js';
import {
  getAccountState, getBackend, getLocalBackend, onAccountChange,
  signInGoogle, signOutGoogle,
} from './cloud.js';
import { state } from './state.js';
import { closeStartMenu, openStartMenu } from './start-menu.js';
import {
  GUEST_STORAGE_SCOPE, getScopedItem, getStorageScope, setScopedItem,
} from './storage-scope.js';
import {
  AUTOSAVE_EVENT, PID_KEY, discardAutosave, flushAutosave, pushHistory,
  restoreFrom, snapshot, tweak,
} from './store.js';
import { fitView } from './view.js';

const CLOUD_SAVE_DELAY = 5000;
const CLOUD_SAVE_TIMEOUT = 15000;

let backend = null;
let account = {
  provider: 'local', configured: false, signedIn: false, user: null, error: null,
};
let tab = 'mine'; // 'mine' | 'shared'
let unwatch = null;
let projects = [];
let shared = [];
let localProjects = [];
let syncTimer = null;
let pendingUnassignedDraft = null;
const pendingCloudDrafts = new Map();
const latestDraftOrder = new Map();
const uncertainCloudWrites = new Set();
let draftOrder = 0;
let syncChain = Promise.resolve(true);
let authAction = false;
let projectActionBusy = false;
const expanded = new Set();
let startProjectsRequest = 0;

export const isProjectsOpen = () => !el('projectsScreen').hidden;

const fmtDate = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
  });
};
const fmtSize = (n) => (n > 1024 * 1024
  ? `${(n / 1024 / 1024).toFixed(1)} МБ`
  : `${Math.max(1, Math.round(n / 1024))} КБ`);

function projectStats() {
  const levels = state.project?.levels || [];
  return { rooms: levels.reduce((sum, level) => sum + level.rooms.length, 0), levels: levels.length };
}

function setSyncStatus(text, status = '') {
  const node = el('cloudSyncStatus');
  if (!node) return;
  node.textContent = text;
  if (status) node.dataset.state = status; else delete node.dataset.state;
  const accountButton = el('accountBtn');
  if (accountButton) {
    if (status) accountButton.dataset.sync = status; else delete accountButton.dataset.sync;
    if (text) accountButton.title = text;
  }
}

function setProjectsBusy(busy) {
  for (const screen of [el('projectsScreen'), el('startScreen')]) {
    if (busy) {
      screen.dataset.busy = 'true';
      screen.setAttribute('aria-busy', 'true');
    } else {
      delete screen.dataset.busy;
      screen.removeAttribute('aria-busy');
    }
  }
}

function developmentGuestAllowed() {
  const local = location.hostname === '127.0.0.1' || location.hostname === 'localhost';
  return local && !new URLSearchParams(location.search).has('authGate');
}

function loginGateActive() {
  return !account.signedIn && !developmentGuestAllowed();
}

function setProfile(prefix, user, fallback) {
  const avatar = el(`${prefix}Avatar`);
  const placeholder = el(`${prefix}Placeholder`);
  const title = user?.name || user?.email || fallback;
  el(`${prefix}Name`).textContent = title;
  el(`${prefix}Email`).textContent = user?.email || (user ? 'Личное облако подключено' : 'Проекты этого браузера');
  if (user?.photoURL) {
    avatar.src = user.photoURL;
    avatar.hidden = false;
    placeholder.hidden = true;
  } else {
    avatar.removeAttribute('src');
    avatar.hidden = true;
    placeholder.hidden = false;
  }
  return title;
}

function renderAccount() {
  const user = account.user;
  const signIn = el('googleSignIn');
  const signOut = el('googleSignOut');
  const accountButton = el('accountBtn');
  const startSignIn = el('startGoogleSignIn');
  const startSignOut = el('startGoogleSignOut');
  const authView = el('startAuthView');
  const projectsView = el('startProjectsView');
  const startupCard = el('startScreen').querySelector('.startup-card');
  const gated = loginGateActive();
  authView.hidden = !gated;
  projectsView.hidden = gated;
  startupCard.classList.toggle('auth-only', gated);
  startupCard.setAttribute('aria-labelledby', gated ? 'startupTitle' : 'startupProjectsTitle');
  startSignIn.hidden = !gated;
  startSignIn.disabled = !account.configured || account.provider !== 'firebase';
  const authStatus = el('startAuthStatus');
  authStatus.textContent = gated
    ? account.error?.message || (!account.configured ? 'Вход через Google временно недоступен. Обновите страницу позже.' : '')
    : '';
  if (user) {
    const fallback = account.provider === 'claude' ? 'Аккаунт claude.ai' : 'Google-аккаунт';
    const title = setProfile('projectsAccount', user, fallback);
    setProfile('startAccount', user, fallback);
    signIn.hidden = true;
    signOut.hidden = account.provider !== 'firebase';
    startSignOut.hidden = account.provider !== 'firebase';
    accountButton.textContent = title.split(/\s+/)[0] || 'Аккаунт';
    accountButton.title = `${title}: облачные проекты`;
    return;
  }
  setProfile('projectsAccount', null, 'Гостевой режим');
  setProfile('startAccount', null, 'Локальная разработка');
  el('projectsAccountName').textContent = 'Гостевой режим';
  el('projectsAccountEmail').textContent = account.error
    ? account.error.message
    : account.configured
      ? 'Войдите, чтобы проекты открывались на любом устройстве'
      : 'Google-облако ещё не настроено; проекты остаются в этом браузере';
  signIn.hidden = !account.configured || account.provider !== 'firebase';
  signIn.disabled = false;
  signOut.hidden = true;
  startSignOut.hidden = true;
  accountButton.textContent = account.configured ? 'Войти' : 'Локально';
  accountButton.title = account.configured
    ? 'Войти через Google и открыть облачные проекты'
    : 'Проекты этого браузера';
}

function stopWatching() {
  unwatch?.();
  unwatch = null;
}

function watch() {
  stopWatching();
  if (!backend || !isProjectsOpen()) return;
  const fail = (error) => {
    el('projectsList').innerHTML = `<p class="hint">Не удалось загрузить: ${escapeHtml(error?.message || 'нет доступа')}</p>`;
  };
  if (tab === 'mine') {
    unwatch = watchProjects(backend.db, backend.root, (list) => {
      projects = list;
      render();
      if (!el('startProjectsView').hidden && !el('startScreen').hidden) renderStartProjects(projects);
    }, fail);
  } else {
    unwatch = watchShared(backend.db, (list) => {
      shared = list;
      render();
    }, fail);
  }
}

function versionRows(project) {
  return (project.versions || []).map((version, index) => `
    <div class="prj-ver">
      <span>${escapeHtml(fmtDate(version.at))}${version.note ? ` · ${escapeHtml(version.note)}` : ''}${index === 0 ? ' · последняя версия' : ''}</span>
      <small>${fmtSize(version.bytes || 0)}</small>
      <button type="button" data-act="open" data-pid="${escapeHtml(project.id)}" data-vid="${escapeHtml(version.id)}">Открыть</button>
    </div>`).join('');
}

function latestStats(project) {
  return project.draftStats || project.versions?.[0]?.stats || null;
}

function renderStartProjects(list) {
  const section = el('startRecentSection');
  const box = el('startRecentProjects');
  const status = el('startRecentStatus');
  const recent = list.slice(0, 6);
  section.hidden = recent.length === 0;
  status.textContent = recent.length ? `${recent.length} последних` : '';
  box.innerHTML = recent.map((project) => {
    const stats = latestStats(project);
    const current = project.id === state.pid;
    const details = [fmtDate(project.updatedAt)];
    if (stats?.rooms) details.push(`помещений: ${Number(stats.rooms)}`);
    return `
      <button class="startup-project-card${current ? ' current' : ''}" type="button"
        data-act="open" data-pid="${escapeHtml(project.id)}">
        <span class="startup-project-preview">${projectPreviewSvg(project.preview, stats)}</span>
        <span class="startup-project-info">
          <b>${escapeHtml(project.name || 'Без названия')}</b>
          <small>${escapeHtml(details.filter(Boolean).join(' · ') || 'Облачный проект')}</small>
        </span>
      </button>`;
  }).join('');
}

async function refreshStartProjects() {
  const request = ++startProjectsRequest;
  const section = el('startRecentSection');
  const status = el('startRecentStatus');
  if (loginGateActive() || el('startProjectsView').hidden) return;
  section.hidden = false;
  status.textContent = 'Загрузка…';
  try {
    if (!backend) await refreshBackend({ restartWatch: false });
    const list = await listProjects(backend.db, backend.root);
    if (request !== startProjectsRequest) return;
    projects = list;
    renderStartProjects(projects);
  } catch (error) {
    if (request !== startProjectsRequest) return;
    section.hidden = false;
    el('startRecentProjects').innerHTML = '';
    status.textContent = `Не удалось загрузить: ${error?.message || 'нет доступа'}`;
  }
}

function render() {
  const box = el('projectsList');
  if (!backend) return;
  if (tab === 'mine') {
    if (!projects.length) {
      box.innerHTML = backend.mode === 'cloud'
        ? '<p class="hint">Облачных проектов пока нет. Начните чертить — черновик сохранится автоматически.</p>'
        : '<p class="hint">Пока ничего не сохранено. Нажмите «Сохранить версию» — проект появится здесь.</p>';
      return;
    }
    box.innerHTML = projects.map((project) => {
      const versions = project.versions || [];
      const open = expanded.has(project.id);
      const current = project.id === state.pid;
      const draft = project.draftUpdatedAt
        ? ` · автосохранено ${escapeHtml(fmtDate(project.draftUpdatedAt))}`
        : '';
      return `
      <div class="prj-row${current ? ' current' : ''}">
        <div class="prj-main">
          <b>${escapeHtml(project.name || 'Без названия')}</b>${current ? ' <em>(открыт)</em>' : ''}
          <small>${escapeHtml(fmtDate(project.updatedAt))} · версий: ${versions.length}${draft}</small>
        </div>
        <div class="prj-actions">
          <button type="button" data-act="open" data-pid="${escapeHtml(project.id)}">Открыть</button>
          ${versions.length ? `<button type="button" data-act="toggle" data-pid="${escapeHtml(project.id)}">${open ? 'Версии ▴' : 'Версии ▾'}</button>` : ''}
          ${backend.provider === 'claude' ? `<button type="button" data-act="publish" data-pid="${escapeHtml(project.id)}" title="Опубликовать снимок для других пользователей">Опубликовать</button>` : ''}
          <button type="button" class="danger" data-act="delete" data-pid="${escapeHtml(project.id)}">Удалить</button>
        </div>
        ${open ? `<div class="prj-vers">${versionRows(project)}</div>` : ''}
      </div>`;
    }).join('');
    return;
  }
  if (!shared.length) {
    box.innerHTML = '<p class="hint">Общих проектов нет. Опубликуйте свой на вкладке «Мои проекты».</p>';
    return;
  }
  box.innerHTML = shared.map((item) => {
    const mine = item.owner === backend.uid;
    return `
      <div class="prj-row">
        <div class="prj-main">
          <b>${escapeHtml(item.name || 'Без названия')}</b>${mine ? ' <em>(мой)</em>' : ''}
          <small>${escapeHtml(fmtDate(item.at))}${item.stats ? ` · комнат: ${escapeHtml(item.stats.rooms ?? 0)}` : ''}</small>
        </div>
        <div class="prj-actions">
          <button type="button" data-act="open-shared" data-owner="${escapeHtml(item.owner)}" data-pid="${escapeHtml(item.pid)}">Открыть копией</button>
          ${mine ? `<button type="button" class="danger" data-act="unpublish" data-pid="${escapeHtml(item.pid)}">Снять</button>` : ''}
        </div>
      </div>`;
  }).join('');
}

function openText(text, pid, missing) {
  const before = snapshot();
  const beforePid = state.pid;
  restoreFrom(text);
  pushHistory(before, beforePid);
  state.pid = pid;
  setScopedItem(PID_KEY, pid || '');
  refs.projectName.value = state.project.name;
  tweak(() => {});
  fitView();
  closeProjects(true);
  closeStartMenu();
  toast(missing?.length
    ? `Открыт «${state.project.name}», но картинка топосъёмки потерялась`
    : `Открыт проект «${state.project.name}»`, Boolean(missing?.length));
}

const hasPendingCloudDraft = () => Boolean(pendingUnassignedDraft || pendingCloudDrafts.size);
const sameBackend = (a, b) => Boolean(a && b
  && a.provider === b.provider && a.uid === b.uid && a.root === b.root);

function clearPendingCloudDrafts() {
  clearTimeout(syncTimer);
  syncTimer = null;
  pendingUnassignedDraft = null;
  pendingCloudDrafts.clear();
  latestDraftOrder.clear();
}

function assignPendingDraft() {
  if (!pendingUnassignedDraft || backend?.mode !== 'cloud') return;
  const pid = state.pid || newId('p');
  state.pid = pid;
  setScopedItem(PID_KEY, pid);
  pendingCloudDrafts.set(pid, { ...pendingUnassignedDraft, pid });
  latestDraftOrder.set(pid, pendingUnassignedDraft.order);
  pendingUnassignedDraft = null;
}

function scheduleCloudDraft(text, { immediate = false } = {}) {
  if (typeof text === 'string' && text) {
    const draft = { text, stats: projectStats(), order: ++draftOrder };
    if (backend?.mode === 'cloud') {
      const pid = state.pid || newId('p');
      state.pid = pid;
      setScopedItem(PID_KEY, pid);
      pendingCloudDrafts.set(pid, { ...draft, pid });
      latestDraftOrder.set(pid, draft.order);
    } else {
      // Backend ещё может инициализироваться. Для гостевого режима это просто
      // последний локальный снимок; после входа он получит новый облачный PID.
      pendingUnassignedDraft = draft;
    }
  }
  if (backend?.mode !== 'cloud') return;
  assignPendingDraft();
  if (!pendingCloudDrafts.size) return;
  clearTimeout(syncTimer);
  if (navigator.onLine === false) {
    setSyncStatus('Офлайн — изменения сохранены на устройстве и будут отправлены позже', 'saving');
    return;
  }
  if (uncertainCloudWrites.size) {
    setSyncStatus('Ждём подтверждения предыдущего сохранения…', 'saving');
    return;
  }
  setSyncStatus('Есть несохранённые изменения…', 'saving');
  if (immediate) queueMicrotask(() => { flushCloudDraft(); });
  else syncTimer = setTimeout(flushCloudDraft, CLOUD_SAVE_DELAY);
}

function withSaveTimeout(promise) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error('сервер не ответил за 15 секунд');
      error.code = 'cloud-timeout';
      reject(error);
    }, CLOUD_SAVE_TIMEOUT);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function rememberUncertainWrite(operation) {
  uncertainCloudWrites.add(operation);
  const settled = () => {
    uncertainCloudWrites.delete(operation);
    if (!uncertainCloudWrites.size && backend?.mode === 'cloud' && hasPendingCloudDraft()) {
      scheduleCloudDraft(null, { immediate: true });
    }
  };
  operation.then(settled, settled);
}

function restoreQueuedEntries(entries, target) {
  if (!sameBackend(backend, target)) return;
  for (const [pid, draft] of entries) {
    if (latestDraftOrder.get(pid) === draft.order && !pendingCloudDrafts.has(pid)) {
      pendingCloudDrafts.set(pid, draft);
    }
  }
}

async function flushCloudDraft() {
  clearTimeout(syncTimer);
  syncTimer = null;
  if (backend?.mode !== 'cloud') return true;
  assignPendingDraft();
  if (!pendingCloudDrafts.size) return syncChain;
  if (navigator.onLine === false) {
    setSyncStatus('Офлайн — изменения сохранены на устройстве и будут отправлены позже', 'saving');
    return false;
  }
  if (uncertainCloudWrites.size) {
    setSyncStatus('Ждём подтверждения предыдущего сохранения…', 'saving');
    return false;
  }

  const target = backend;
  const entries = [...pendingCloudDrafts.entries()];
  for (const [pid, draft] of entries) {
    if (pendingCloudDrafts.get(pid) === draft) pendingCloudDrafts.delete(pid);
  }
  const run = async () => {
    if (uncertainCloudWrites.size) {
      restoreQueuedEntries(entries, target);
      setSyncStatus('Ждём подтверждения предыдущего сохранения…', 'saving');
      return false;
    }
    setSyncStatus('Сохраняем в облако…', 'saving');
    let ok = true;
    let savedAt = null;
    let lastError = null;
    for (const [pid, draft] of entries) {
      const operation = saveDraft(target.db, target.root, draft.text, {
        pid, stats: draft.stats,
      });
      try {
        const saved = await withSaveTimeout(operation);
        savedAt = saved.draft.updatedAt;
        if (latestDraftOrder.get(pid) === draft.order) latestDraftOrder.delete(pid);
      } catch (error) {
        ok = false;
        lastError = error;
        if (error?.code === 'cloud-timeout') rememberUncertainWrite(operation);
        // Более новый снимок того же проекта уже содержит все прошлые правки.
        if (sameBackend(backend, target) && latestDraftOrder.get(pid) === draft.order
          && !pendingCloudDrafts.has(pid)) pendingCloudDrafts.set(pid, draft);
      }
    }
    if (sameBackend(backend, target)) {
      if (ok) setSyncStatus(`Сохранено в облаке ${fmtDate(savedAt)}`, 'saved');
      else setSyncStatus(`Не удалось синхронизировать: ${lastError?.message || 'ошибка'}`, 'error');
      if (hasPendingCloudDraft() && !uncertainCloudWrites.size) scheduleCloudDraft(null);
    }
    return ok;
  };
  syncChain = syncChain.then(run, run);
  return syncChain;
}

async function saveCurrent() {
  const button = el('prjSave');
  button.disabled = true;
  try {
    if (!backend) backend = await getBackend();
    const pid = state.pid || newId('p');
    const { unchanged, meta } = await saveVersion(backend.db, backend.root, serializeProject(state.project), {
      pid, note: el('prjNote').value.trim(), stats: projectStats(),
    });
    state.pid = pid;
    setScopedItem(PID_KEY, pid);
    tweak(() => {});
    el('prjNote').value = '';
    if (backend.mode === 'cloud') setSyncStatus('Контрольная версия сохранена в облаке', 'saved');
    toast(unchanged ? 'Без изменений с последней версии' : `Версия сохранена (всего ${meta.versions.length})`);
  } catch (error) {
    toast(`Не сохранилось: ${error.message}`, true);
  } finally {
    button.disabled = false;
  }
}

async function onAction(button) {
  if (projectActionBusy || authAction) return;
  projectActionBusy = true;
  button.disabled = true;
  setProjectsBusy(true);
  const {
    act, pid, vid, owner,
  } = button.dataset;
  try {
    if (act === 'toggle') {
      if (expanded.has(pid)) expanded.delete(pid); else expanded.add(pid);
      render();
    } else if (act === 'open') {
      flushAutosave();
      if (!await flushCloudDraft()) {
        toast('Текущий проект ещё не попал в облако. Проверьте интернет и повторите.', true);
        return;
      }
      const { text, missing } = await loadVersion(backend.db, backend.root, pid, vid || null);
      openText(text, pid, missing);
    } else if (act === 'open-shared') {
      flushAutosave();
      if (!await flushCloudDraft()) {
        toast('Текущий проект ещё не попал в облако. Проверьте интернет и повторите.', true);
        return;
      }
      const { text, missing } = await loadShared(backend.db, owner, pid);
      openText(text, null, missing);
    } else if (act === 'delete') {
      const project = projects.find((candidate) => candidate.id === pid);
      if (!window.confirm(`Удалить «${project?.name || 'проект'}» со всеми версиями?`)) return;
      flushAutosave();
      if (!await flushCloudDraft()) {
        toast('Облачное сохранение ещё не подтвердилось. Дождитесь статуса и повторите удаление.', true);
        return;
      }
      if (hasPendingCloudDraft() || uncertainCloudWrites.size) {
        toast('Появились новые несохранённые изменения. Повторите удаление после синхронизации.', true);
        return;
      }
      clearTimeout(syncTimer);
      syncTimer = null;
      pendingCloudDrafts.delete(pid);
      latestDraftOrder.delete(pid);
      if (state.pid === pid) pendingUnassignedDraft = null;
      await deleteProject(backend.db, backend.root, pid);
      if (state.pid === pid) {
        state.pid = null;
        setScopedItem(PID_KEY, '');
        discardAutosave();
      }
      toast('Проект удалён');
    } else if (act === 'publish') {
      if (backend.provider !== 'claude') throw new Error('Общие публикации недоступны для Google-облака');
      if (!window.confirm('Опубликовать снимок? Его смогут открыть все пользователи, вошедшие в Kepler Plan.')) return;
      flushAutosave();
      if (!await flushCloudDraft()) {
        toast('Сначала дождитесь сохранения проекта в облако.', true);
        return;
      }
      const { text } = await loadVersion(backend.db, backend.root, pid);
      await publishProject(backend.db, backend.uid, text, { pid, stats: projectStats() });
      toast('Опубликовано: снимок виден вошедшим пользователям во вкладке «Общие»');
    } else if (act === 'unpublish') {
      if (backend.provider !== 'claude') throw new Error('Общие публикации недоступны для Google-облака');
      await unpublishProject(backend.db, backend.uid, pid);
      toast('Публикация снята');
    }
  } catch (error) {
    toast(`Ошибка: ${error.message}`, true);
  } finally {
    projectActionBusy = false;
    button.disabled = false;
    setProjectsBusy(false);
  }
}

function setTab(next) {
  tab = next;
  el('prjTabMine').classList.toggle('active', tab === 'mine');
  el('prjTabShared').classList.toggle('active', tab === 'shared');
  el('projectsSave').hidden = tab !== 'mine';
  el('projectsList').innerHTML = '<p class="hint">Загрузка…</p>';
  watch();
}

async function refreshTransferOffer() {
  const panel = el('projectsTransfer');
  panel.hidden = true;
  localProjects = [];
  if (backend?.provider !== 'firebase') return;
  try {
    const local = await getLocalBackend();
    localProjects = await listProjects(local.db, local.root);
    panel.hidden = localProjects.length === 0;
  } catch {
    panel.hidden = true;
  }
}

async function transferLocalProjects() {
  if (backend?.provider !== 'firebase' || !localProjects.length) return;
  if (!window.confirm(`Скопировать в Google-облако локальные проекты: ${localProjects.length}? Локальные копии останутся.`)) return;
  const button = el('projectsTransferBtn');
  const oldText = button.textContent;
  button.disabled = true;
  try {
    const local = await getLocalBackend();
    let copied = 0;
    for (const project of localProjects) {
      const targetPid = newId('p');
      const versions = [...(project.versions || [])].reverse();
      if (!versions.length) {
        const latest = await loadVersion(local.db, local.root, project.id);
        await saveVersion(backend.db, backend.root, latest.text, {
          pid: targetPid, note: 'Перенесено из браузера', stats: latest.version?.stats || null,
        });
      } else {
        for (const version of versions) {
          const loaded = await loadVersion(local.db, local.root, project.id, version.id);
          await saveVersion(backend.db, backend.root, loaded.text, {
            pid: targetPid,
            note: version.note || '',
            stats: version.stats || null,
            now: new Date(version.at),
          });
        }
      }
      copied += 1;
      button.textContent = `Скопировано ${copied} из ${localProjects.length}`;
    }
    el('projectsTransfer').hidden = true;
    toast(`Скопировано в облако проектов: ${copied}`);
  } catch (error) {
    toast(`Не удалось перенести проекты: ${error.message}`, true);
  } finally {
    button.disabled = false;
    button.textContent = oldText;
  }
}

function updateModeText() {
  if (backend?.provider === 'firebase') {
    el('projectsMode').textContent = 'Google-облако: черновик сохраняется автоматически, контрольные версии — по кнопке.';
  } else if (backend?.provider === 'claude') {
    el('projectsMode').textContent = 'Облако claude.ai: проекты привязаны к вашей учётной записи.';
  } else {
    el('projectsMode').textContent = `Хранятся в этом браузере${backend?.persistent ? '' : ' (до закрытия вкладки: браузер не дал сохранить)'}.${account.configured ? ' Войдите через Google для облачной синхронизации.' : ''}`;
  }
}

async function refreshBackend({ restartWatch = true } = {}) {
  backend = await getBackend();
  updateModeText();
  const cloud = backend.mode === 'cloud';
  const sharedAvailable = backend.provider === 'claude';
  el('prjTabShared').hidden = !sharedAvailable;
  if (!sharedAvailable && tab === 'shared') tab = 'mine';
  if (restartWatch && isProjectsOpen()) setTab(tab);
  await refreshTransferOffer();
  if (cloud && hasPendingCloudDraft()) scheduleCloudDraft(null);
  return backend;
}

export async function openProjects() {
  el('projectsScreen').hidden = false;
  el('projectsList').innerHTML = '<p class="hint">Загрузка…</p>';
  account = await getAccountState();
  renderAccount();
  await refreshBackend({ restartWatch: false });
  setTab(backend.provider === 'claude' ? tab : 'mine');
}

export async function openProjectChooser(options = {}) {
  if (options.initial && !options.broken && developmentGuestAllowed()) {
    try {
      if (sessionStorage.getItem('kepler-startup-chosen') === '1') return;
    } catch { /* режим без sessionStorage */ }
  }
  openStartMenu(options);
  renderAccount();
  if (loginGateActive()) {
    requestAnimationFrame(() => el('startGoogleSignIn').focus({ preventScroll: true }));
    return;
  }
  requestAnimationFrame(() => el('startNew').focus({ preventScroll: true }));
  await refreshStartProjects();
}

export function closeProjects(force = false) {
  if ((projectActionBusy || authAction) && !force) return;
  el('projectsScreen').hidden = true;
  stopWatching();
}

async function handleSignIn() {
  const buttons = [el('googleSignIn'), el('startGoogleSignIn')];
  buttons.forEach((button) => { button.disabled = true; });
  authAction = true;
  setProjectsBusy(true);
  try {
    const next = await signInGoogle();
    account = next;
    const uid = next.user?.uid;
    if (!uid) throw new Error('Google не вернул пользователя');
    // Гостевой черновик остаётся в guest namespace. Scope меняет только
    // следующий boot: иначе pagehide успел бы записать гостевой проект уже
    // под UID вошедшего пользователя.
    flushAutosave();
    window.location.reload();
  } catch (error) {
    account = { ...account, error };
    renderAccount();
    toast(`Не удалось войти: ${error.message}`, true);
  } finally {
    authAction = false;
    setProjectsBusy(false);
    buttons.forEach((button) => { button.disabled = false; });
  }
}

async function handleSignOut() {
  const buttons = [el('googleSignOut'), el('startGoogleSignOut')];
  buttons.forEach((button) => { button.disabled = true; });
  authAction = true;
  setProjectsBusy(true);
  try {
    flushAutosave();
    if (!await flushCloudDraft()) throw new Error('проект ещё не синхронизирован; проверьте интернет и повторите выход');
    await signOutGoogle();
    // Scope остаётся прежним до pagehide, чтобы открытый проект не попал в
    // guest namespace. Следующий boot сам выберет гостевой scope.
    window.location.reload();
  } catch (error) {
    authAction = false;
    setProjectsBusy(false);
    buttons.forEach((button) => { button.disabled = false; });
    toast(`Не удалось выйти: ${error.message}`, true);
  }
}

export function bindProjects(initialAccount = null) {
  if (initialAccount) account = initialAccount;
  try { state.pid = getScopedItem(PID_KEY) || null; } catch { state.pid = null; }
  el('projectsBtn').addEventListener('click', openProjects);
  el('accountBtn').addEventListener('click', openProjects);
  el('projectsClose').addEventListener('click', () => closeProjects());
  el('projectsScreen').addEventListener('click', (event) => {
    if (event.target.id === 'projectsScreen') closeProjects();
  });
  el('prjTabMine').addEventListener('click', () => setTab('mine'));
  el('prjTabShared').addEventListener('click', () => setTab('shared'));
  el('prjSave').addEventListener('click', saveCurrent);
  el('googleSignIn').addEventListener('click', handleSignIn);
  el('startGoogleSignIn').addEventListener('click', handleSignIn);
  el('googleSignOut').addEventListener('click', handleSignOut);
  el('startGoogleSignOut').addEventListener('click', handleSignOut);
  el('projectsTransferBtn').addEventListener('click', transferLocalProjects);
  el('projectsList').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-act]');
    if (button) onAction(button);
  });
  el('startRecentProjects').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-act]');
    if (button) onAction(button);
  });
  document.addEventListener(AUTOSAVE_EVENT, (event) => {
    scheduleCloudDraft(event.detail?.text, { immediate: document.visibilityState === 'hidden' });
  });
  window.addEventListener('online', () => {
    if (hasPendingCloudDraft()) scheduleCloudDraft(null, { immediate: true });
  });
  window.addEventListener('pagehide', () => {
    flushAutosave();
    flushCloudDraft();
  });
  onAccountChange(async (next) => {
    const wasSignedIn = account.signedIn;
    const previousUid = account.user?.uid || null;
    const nextUid = next.user?.uid || null;
    account = next;
    renderAccount();
    // Явный вход/выход сам переключает namespace и backend в безопасном
    // порядке. Auth callback приходит раньше завершения popup promise.
    if (authAction) return;
    if (wasSignedIn && !next.signedIn && getStorageScope() !== GUEST_STORAGE_SCOPE) {
      flushAutosave();
      clearPendingCloudDrafts();
      window.location.reload();
      return;
    }
    if (next.signedIn && nextUid
      && (getStorageScope() !== nextUid || (previousUid && previousUid !== nextUid))) {
      flushAutosave();
      clearPendingCloudDrafts();
      window.location.reload();
      return;
    }
    await refreshBackend();
  });
  renderAccount();
  getAccountState().then((next) => {
    account = next;
    renderAccount();
    return refreshBackend({ restartWatch: false });
  }).catch((error) => {
    account = { provider: 'local', configured: false, signedIn: false, user: null, error };
    renderAccount();
  });
}

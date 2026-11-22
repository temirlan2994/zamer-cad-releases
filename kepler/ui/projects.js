// Панель «Проекты»: локальные версии для гостя и личное облако после
// входа через Google/Firebase (или capability Claude в артефакте).
// Облачный draft сохраняется отдельно от ручных версий.

import { deserializeProject, serializeProject } from '../core/model.js';
import { projectPreviewHtml, safeProjectPreview } from '../core/project-preview.js';
import {
  deleteProject, getProject, hashText, listProjects, loadDraft, loadShared, loadVersion, newId, publishProject,
  saveDraft, saveVersion, unpublishProject, updateProjectPreview, watchProjects, watchShared,
} from '../core/storage.js';
import {
  acquireEditLease, cancelEditLeaseRequest, classifyObservedEditLease, EDIT_HEARTBEAT_MS,
  grantRequestedEditLease, heartbeatEditLease, leaseExpired, leaseHeldBy,
  newEditSessionId, readEditLease, rejectEditLeaseRequest, releaseEditLease,
  requestEditLease, takeoverEditLease, watchEditLease,
} from '../core/edit-lease.js';
import { el, escapeHtml, toast } from './dom.js';
import {
  getAccountState, getBackend, getLocalBackend, onAccountChange,
  signInGoogle, signOutGoogle,
} from './cloud.js';
import {
  currentProjectName, PROJECT_NAME_EVENT, syncProjectNameUi,
} from './project-name.js';
import { state } from './state.js';
import { closeStartMenu, openStartMenu, rememberEditor } from './start-menu.js';
import { shouldUseRemoteProject } from './startup-cloud.js';
import {
  GUEST_STORAGE_SCOPE, getScopedItem, getStorageScope, setScopedItem,
} from './storage-scope.js';
import {
  AUTOSAVE_EVENT, PID_KEY, clearHistory, discardAutosave,
  flushAutosave, pushHistory, restoreFrom, snapshot, tweak,
} from './store.js';
import { fitView } from './view.js';
import { cancelEditingGesture } from './edit-guard.js';
import {
  bindEditLockUi, hideEditLock, setEditLockBusy, showEditLock,
} from './edit-lock-ui.js';
import { PROJECT_REPLACED_EVENT } from './files.js';
import { createProjectThumbnail } from './project-thumbnail.js';

const CLOUD_SAVE_DELAY = 5000;
const CLOUD_SAVE_TIMEOUT = 15000;
const LEASE_REQUEST_TIMEOUT = 12_000;
const LEASE_SAFETY_MARGIN = 15_000;
const DEVICE_ID_KEY = 'kepler-edit-device-id';
const SESSION_ID_KEY = 'kepler-edit-session-id';

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
const previewUpgradeQueued = new Set();
const previewUpgradeDone = new Set();
let draftOrder = 0;
let syncChain = Promise.resolve(true);
let previewUpgradeChain = Promise.resolve();
let authAction = false;
let projectActionBusy = false;
const expanded = new Set();
let startProjectsRequest = 0;
let activeEditor = null; // { pid, lease, unsubscribe, timer, lastHeartbeat }
let handoffBusy = false;
let pendingLeaseFlow = null;
let lostEditor = null; // { pid, lease, localText }
let replacementBusy = false;
let deleteBusyPid = null;

function storedId(storage, key, prefix) {
  try {
    let value = storage?.getItem(key) || '';
    if (!/^[A-Za-z0-9._:@+~-]{1,128}$/.test(value)) {
      value = `${prefix}${newEditSessionId()}`.slice(0, 128);
      storage?.setItem(key, value);
    }
    return value;
  } catch {
    return `${prefix}${newEditSessionId()}`.slice(0, 128);
  }
}

function deviceName() {
  const ua = navigator.userAgent || '';
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/Android/i.test(ua)) return 'Android-телефон';
  if (/Windows/i.test(ua)) return 'Компьютер Windows';
  if (/Mac/i.test(ua)) return 'Компьютер Mac';
  if (/Linux/i.test(ua)) return 'Компьютер Linux';
  return 'Другое устройство';
}

function pageSessionId() {
  let reload = false;
  try {
    reload = performance.getEntriesByType?.('navigation')?.[0]?.type === 'reload';
  } catch { /* старый браузер */ }
  // sessionStorage клонируется при «Дублировать вкладку». Повторно используем
  // token только при настоящем reload; новая/дублированная вкладка получает
  // отдельного редактора и не может притвориться владельцем lease.
  if (!reload) {
    try { globalThis.sessionStorage?.removeItem(SESSION_ID_KEY); } catch { /* приватный режим */ }
  }
  return storedId(globalThis.sessionStorage, SESSION_ID_KEY, 'tab');
}

const editorIdentity = {
  deviceId: storedId(globalThis.localStorage, DEVICE_ID_KEY, 'dev'),
  sessionId: pageSessionId(),
  deviceName: deviceName(),
};

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

function projectErrorText(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  if (code.includes('permission-denied') || /missing or insufficient permissions/i.test(message)) {
    return 'Firestore не разрешил доступ. Опубликуйте обновлённые правила; локальный проект можно продолжить выше.';
  }
  return message || 'нет доступа';
}

function projectStats() {
  const levels = state.project?.levels || [];
  return { rooms: levels.reduce((sum, level) => sum + level.rooms.length, 0), levels: levels.length };
}

function currentProjectThumbnail() {
  try {
    return createProjectThumbnail(state.project);
  } catch {
    // Старое SVG-превью остаётся безопасным запасным вариантом, если браузер
    // не поддерживает кодирование canvas или модель ещё не готова к рендеру.
    return null;
  }
}

const previewUpgradeKey = (target, pid) => `${target?.provider || ''}|${target?.root || ''}|${pid}`;

async function upgradeProjectThumbnail(target, project) {
  if (!target || backend !== target || !project?.id) return false;
  const loaded = await loadLatestServerProject(project.id);
  if (backend !== target) return false;
  const preview = createProjectThumbnail(deserializeProject(loaded.text));
  if (!preview) return true;

  let lease = null;
  let borrowedLease = false;
  let editor = null;
  if (usesEditLease(target)) {
    if (activeEditor?.pid === project.id && leaseHeldBy(activeEditor.lease, editorIdentity)) {
      lease = activeEditor.lease;
    } else {
      const observed = await readEditLease(target.db, target.root, project.id);
      // Совсем старый проект без lease можно обновить по legacy-правилам без
      // лишней блокировки. Если lease уже существует, даже истёкший, запись
      // обязательно проходит через актуальный fencing epoch.
      if (observed) {
        // Не отбрасываем свежий lease заранее: после перезапуска PWA у того
        // же телефона/компьютера меняется sessionId, но сохраняется deviceId.
        // acquireEditLease безопасно отличит своё устройство от чужого и
        // выдаст новый fencing epoch либо вернёт occupied.
        const acquired = await acquireEditLease(target.db, target.root, project.id, editorIdentity);
        if (acquired.status !== 'acquired') return false;
        lease = acquired.lease;
        borrowedLease = true;
      }
    }
    if (lease) editor = { sessionId: lease.sessionId, epoch: lease.epoch };
  }

  try {
    await updateProjectPreview(target.db, target.root, project.id, preview, { editor });
  } finally {
    if (borrowedLease) {
      try { await releaseEditLease(target.db, target.root, project.id, lease); } catch { /* lease сам истечёт */ }
    }
  }
  if (backend === target) {
    const current = projects.find((candidate) => candidate.id === project.id);
    if (current) current.preview = preview;
    if (!el('startProjectsView').hidden && !el('startScreen').hidden) renderStartProjects(projects);
  }
  return true;
}

function scheduleProjectThumbnailUpgrades(list) {
  const target = backend;
  if (!target || loginGateActive()) return;
  for (const project of list) {
    const preview = safeProjectPreview(project?.preview);
    // Первая версия растрового снимка сохранялась как WebP и намеренно
    // скрывала детали листа. JPEG служит маркером нового снимка полного
    // плана, поэтому существующие WebP-карточки один раз перерисуются.
    if (preview?.v === 2 && preview.image.startsWith('data:image/jpeg;base64,')) continue;
    const key = previewUpgradeKey(target, project?.id);
    if (!project?.id || previewUpgradeQueued.has(key) || previewUpgradeDone.has(key)) continue;
    previewUpgradeQueued.add(key);
    previewUpgradeChain = previewUpgradeChain.then(async () => {
      try {
        if (await upgradeProjectThumbnail(target, project)) previewUpgradeDone.add(key);
      } catch { /* проект мог быть удалён или открыт на другом устройстве — повторим при следующем запуске */ }
      finally { previewUpgradeQueued.delete(key); }
    });
  }
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

function usesEditLease(target = backend) {
  return Boolean(target?.mode === 'cloud' && target.provider === 'firebase'
    && typeof target.db?.runTransaction === 'function');
}

function stopLeaseMonitoring() {
  if (!activeEditor) return null;
  const current = activeEditor;
  current.unsubscribe?.();
  clearInterval(current.timer);
  activeEditor = null;
  state.editLeasePid = null;
  return current;
}

async function detachActiveEditor({ release = true } = {}) {
  const current = stopLeaseMonitoring();
  if (!current || !release || !usesEditLease()) return current;
  try { await releaseEditLease(backend.db, backend.root, current.pid, current.lease); }
  catch { /* expiry всё равно освободит закрытый проект */ }
  return current;
}

function lockEditor(reason, {
  kind = 'moved', lease = null, deviceName: label = '', status = '', localText = null,
} = {}) {
  cancelEditingGesture();
  state.editLocked = true;
  state.editLockReason = reason;
  const text = localText || (() => {
    try { return serializeProject(state.project, { pretty: false }); } catch { return null; }
  })();
  if (state.pid) lostEditor = { pid: state.pid, lease, localText: text };
  showEditLock({ kind, deviceName: label || lease?.deviceName || '', status });
}

function unlockEditor() {
  state.editLocked = false;
  state.editLockReason = '';
  lostEditor = null;
  hideEditLock();
  if (el('startScreen').hidden) document.querySelector('.app')?.removeAttribute('inert');
}

function clearPendingFor(pid) {
  if (!pid) return;
  pendingCloudDrafts.delete(pid);
  latestDraftOrder.delete(pid);
}

function markLeaseLost(lease, status = 'Право редактирования перешло на другое устройство', pidHint = null) {
  // Тайм-аут, отсутствие документа и собственный lease не являются
  // доказательством второго редактора. Это важно и для текста окна: свой
  // компьютер никогда не должен подписываться как «другое устройство».
  if (!lease || leaseHeldBy(lease, editorIdentity)) {
    setSyncStatus('Не удалось подтвердить связь с облаком — изменения сохранены на устройстве', 'saving');
    return false;
  }
  const current = activeEditor && (!pidHint || activeEditor.pid === pidHint)
    ? stopLeaseMonitoring()
    : null;
  const pid = current?.pid || pidHint || state.pid;
  if (pid && state.pid && pid !== state.pid) {
    clearPendingFor(pid);
    return;
  }
  cancelEditingGesture();
  let localText = null;
  try {
    flushAutosave();
    localText = serializeProject(state.project, { pretty: false });
  } catch { /* резерв остаётся в localStorage, если сериализация возможна */ }
  clearPendingFor(pid);
  lockEditor('lost', {
    kind: 'moved', lease, deviceName: lease?.deviceName,
    status, localText,
  });
  return true;
}

function markLeaseConnectionRestored(current) {
  if (!current?.connectionUncertain) return;
  current.connectionUncertain = false;
  setSyncStatus('Связь с облаком восстановлена', 'saved');
}

async function maintainEditorLease(force = false) {
  const current = activeEditor;
  if (!current || !usesEditLease()) return false;
  if (navigator.onLine === false) {
    current.connectionUncertain = true;
    setSyncStatus('Офлайн — изменения сохраняются на этом устройстве', 'saving');
    return false;
  }
  // Несколько событий могут одновременно попросить проверку (online,
  // visibilitychange, autosave, snapshot). Все ждут один transaction, чтобы
  // очередь черновика не осталась локальной из-за промежуточного false.
  if (current.heartbeatPromise) return current.heartbeatPromise;
  const now = Date.now();
  const expiresSoon = leaseExpired(current.lease, now + LEASE_SAFETY_MARGIN);
  if (!force && !expiresSoon && now - current.lastHeartbeat < EDIT_HEARTBEAT_MS) return true;
  const operation = (async () => {
    try {
      const result = await heartbeatEditLease(backend.db, backend.root, current.pid, current.lease);
      if (activeEditor !== current) return false;
      if (result.status === 'renewed') {
        current.lease = result.lease;
        current.lastHeartbeat = now;
        markLeaseConnectionRestored(current);
        return true;
      }
      const observed = classifyObservedEditLease(result.lease, editorIdentity, {
        fromCache: false, hasPendingWrites: false,
      });
      if (observed === 'occupied') {
        markLeaseLost(result.lease);
        return false;
      }
      // Heartbeat мог опоздать после сна вкладки, хотя никто проект не
      // забирал. Атомарно пытаемся получить lease снова: только occupied
      // действительно подтверждает другой активный sessionId.
      const acquired = await acquireEditLease(backend.db, backend.root, current.pid, editorIdentity);
      if (activeEditor !== current) return false;
      if (acquired.status === 'acquired') {
        current.lease = acquired.lease;
        current.lastHeartbeat = Date.now();
        markLeaseConnectionRestored(current);
        return true;
      }
      markLeaseLost(acquired.lease);
      return false;
    } catch {
      if (activeEditor === current) {
        current.connectionUncertain = true;
        setSyncStatus('Нет связи с облаком — изменения сохранены на устройстве', 'saving');
      }
      return false;
    }
  })();
  current.heartbeatPromise = operation;
  try { return await operation; }
  finally {
    if (current.heartbeatPromise === operation) current.heartbeatPromise = null;
  }
}

async function handoffRequested(lease) {
  if (handoffBusy || !activeEditor || !leaseHeldBy(lease, activeEditor.lease)) return;
  // Удаление сначала атомарно убирает карточку проекта. До этого момента
  // нельзя автоматически передать lease и открыть на втором устройстве уже
  // частично очищенные данные.
  if (deleteBusyPid === activeEditor.pid) return;
  handoffBusy = true;
  const current = activeEditor;
  lockEditor('handoff', {
    kind: 'moved', lease, deviceName: lease.requestedDeviceName,
    status: 'Сохраняем последние изменения перед передачей…',
  });
  const localText = (() => {
    try { return serializeProject(state.project, { pretty: false }); } catch { return null; }
  })();
  setEditLockBusy(true, 'Сохраняем последние изменения перед передачей…');
  try {
    flushAutosave({ cloudImmediate: true });
    const saved = await flushCloudDraft();
    if (!saved) throw new Error('Не удалось сохранить последние изменения');
    const granted = await grantRequestedEditLease(backend.db, backend.root, current.pid, current.lease);
    if (granted.status !== 'granted') {
      const observed = classifyObservedEditLease(granted.lease, editorIdentity, {
        fromCache: false, hasPendingWrites: false,
      });
      if (observed === 'occupied') {
        markLeaseLost(granted.lease);
        return;
      }
      const recovered = await maintainEditorLease(true);
      if (!recovered && state.editLockReason === 'lost') return;
      throw new Error(recovered
        ? 'Передача не состоялась; право редактирования осталось здесь'
        : 'Не удалось подтвердить передачу проекта');
    }
    if (activeEditor === current) stopLeaseMonitoring();
    clearPendingFor(current.pid);
    lostEditor = { pid: current.pid, lease: granted.lease, localText };
    state.editLocked = true;
    state.editLockReason = 'lost';
    setEditLockBusy(false, 'Последняя модель сохранена в облаке и передана другому устройству.');
  } catch (error) {
    if (activeEditor === current) {
      try { await rejectEditLeaseRequest(backend.db, backend.root, current.pid, current.lease); } catch { /* сеть ниже */ }
      state.editLocked = false;
      state.editLockReason = '';
      lostEditor = null;
      hideEditLock();
      toast(`Не удалось передать проект: ${error.message}`, true);
    }
  } finally {
    handoffBusy = false;
  }
}

function startActiveEditor(pid, lease) {
  stopLeaseMonitoring();
  const current = {
    pid, lease, unsubscribe: null, timer: null, lastHeartbeat: Date.now(),
    heartbeatPromise: null, connectionUncertain: false,
  };
  activeEditor = current;
  state.editLeasePid = pid;
  state.editLocked = false;
  state.editLockReason = '';
  lostEditor = null;
  current.unsubscribe = watchEditLease(backend.db, backend.root, pid, (next, metadata) => {
    if (activeEditor !== current) return;
    const observed = classifyObservedEditLease(next, editorIdentity, metadata);
    if (observed === 'owned') {
      current.lease = next;
      markLeaseConnectionRestored(current);
      if (next.requestedSessionId && next.requestedSessionId !== editorIdentity.sessionId) handoffRequested(next);
      return;
    }
    if (observed === 'occupied') markLeaseLost(next);
    else maintainEditorLease(true);
  }, (error) => {
    if (activeEditor === current) {
      current.connectionUncertain = true;
      setSyncStatus(
        `Нет связи с облаком — изменения сохранены на устройстве${error?.message ? ` (${error.message})` : ''}`,
        'saving',
      );
    }
  });
  current.timer = setInterval(() => { maintainEditorLease(); }, 10_000);
  hideEditLock();
  return current;
}

function finishPendingLease(lease) {
  const pending = pendingLeaseFlow;
  if (!pending) return;
  clearTimeout(pending.timer);
  pending.unsubscribe?.();
  pendingLeaseFlow = null;
  pending.resolve(lease || null);
}

function waitForRequestedLease(pid, occupied, { kind = 'occupied' } = {}) {
  if (pendingLeaseFlow) throw new Error('Передача другого проекта уже выполняется');
  state.editLocked = true;
  state.editLockReason = 'waiting';
  cancelEditingGesture();
  showEditLock({
    kind, deviceName: occupied?.deviceName,
    status: 'Чтобы забрать редактирование, нажмите кнопку ниже.',
  });
  return new Promise((resolve) => {
    pendingLeaseFlow = {
      pid, occupied, kind, resolve, requested: false, forceReady: false,
      unsubscribe: null, timer: null,
    };
  });
}

function watchPendingLease(pending) {
  pending.unsubscribe?.();
  pending.unsubscribe = watchEditLease(backend.db, backend.root, pending.pid, (lease) => {
    if (pendingLeaseFlow !== pending) return;
    if (leaseHeldBy(lease, editorIdentity)) {
      finishPendingLease(lease);
      return;
    }
    pending.occupied = lease;
    if (pending.requested && lease?.requestedSessionId !== editorIdentity.sessionId) {
      clearTimeout(pending.timer);
      pending.forceReady = true;
      setEditLockBusy(false, 'Другое устройство не передало проект. Нажмите ещё раз, чтобы забрать редактирование.', 'error');
    }
  }, (error) => setEditLockBusy(false, error?.message || 'Нет связи с сервером', 'error'));
}

async function requestPendingLease() {
  const pending = pendingLeaseFlow;
  if (!pending) return;
  setEditLockBusy(true, pending.forceReady
    ? 'Забираем право редактирования…'
    : 'Ждём сохранения с другого устройства…');
  try {
    if (pending.forceReady) {
      const result = await takeoverEditLease(backend.db, backend.root, pending.pid, editorIdentity, { force: true });
      if (result.status !== 'acquired') throw new Error('Не удалось забрать редактирование');
      finishPendingLease(result.lease);
      return;
    }
    const result = await requestEditLease(backend.db, backend.root, pending.pid, editorIdentity);
    if (result.status === 'acquired' || result.status === 'owned') {
      finishPendingLease(result.lease);
      return;
    }
    pending.requested = true;
    pending.occupied = result.lease;
    watchPendingLease(pending);
    clearTimeout(pending.timer);
    pending.timer = setTimeout(() => {
      if (pendingLeaseFlow !== pending) return;
      pending.forceReady = true;
      setEditLockBusy(false, 'Устройство не отвечает. Нажмите ещё раз, чтобы принудительно продолжить здесь.', 'error');
    }, LEASE_REQUEST_TIMEOUT);
  } catch (error) {
    setEditLockBusy(false, error.message || 'Не удалось запросить передачу', 'error');
  }
}

async function acquireProjectLease(pid, { kind = 'occupied' } = {}) {
  if (!usesEditLease()) return { lease: null, contended: false };
  if (activeEditor?.pid === pid && leaseHeldBy(activeEditor.lease, editorIdentity)) {
    return { lease: activeEditor.lease, contended: false };
  }
  const result = await acquireEditLease(backend.db, backend.root, pid, editorIdentity);
  if (result.status === 'acquired') return { lease: result.lease, contended: false };
  const lease = await waitForRequestedLease(pid, result.lease, { kind });
  return { lease, contended: true };
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
    el('projectsList').innerHTML = `<p class="hint">Не удалось загрузить: ${escapeHtml(projectErrorText(error))}</p>`;
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
        <span class="startup-project-preview">${projectPreviewHtml(project.preview, stats)}</span>
        <span class="startup-project-info">
          <b>${escapeHtml(current ? currentProjectName() : project.name || 'Без названия')}</b>
          <small>${escapeHtml(details.filter(Boolean).join(' · ') || 'Облачный проект')}</small>
        </span>
      </button>`;
  }).join('');
  // Старые карточки содержат только прямоугольную схему. Полные проекты
  // загружаются по одному в фоне и получают настоящий снимок первого этажа.
  scheduleProjectThumbnailUpgrades(list);
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
    status.textContent = `Не удалось загрузить: ${projectErrorText(error)}`;
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
          <b>${escapeHtml(current ? currentProjectName() : project.name || 'Без названия')}</b>${current ? ' <em>(открыт)</em>' : ''}
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

function openText(text, pid, missing, name = null, { resetHistory = false } = {}) {
  const before = snapshot();
  const beforePid = state.pid;
  restoreFrom(text);
  if (pid && name) state.project.name = name;
  if (resetHistory) clearHistory(); else pushHistory(before, beforePid);
  state.pid = pid;
  setScopedItem(PID_KEY, pid || '');
  syncProjectNameUi();
  tweak(() => {});
  fitView();
  closeProjects(true);
  closeStartMenu();
  toast(missing?.length
    ? `Открыт «${state.project.name}», но картинка топосъёмки потерялась`
    : `Открыт проект «${state.project.name}»`, Boolean(missing?.length));
}

async function loadLatestServerProject(pid, vid = null, { fallbackText = null } = {}) {
  if (vid) return loadVersion(backend.db, backend.root, pid, vid);
  const meta = await getProject(backend.db, backend.root, pid, { server: true });
  if (!meta) {
    if (fallbackText) return {
      text: fallbackText, meta: null, missing: [], localOnly: true,
    };
    throw new Error('Проект не найден (возможно, он удалён)');
  }
  const draft = await loadDraft(backend.db, backend.root, pid, { server: true });
  if (draft) {
    return {
      text: draft.text, meta, missing: draft.missing,
      version: { id: 'draft', at: draft.draft.updatedAt, isDraft: true },
      draft: draft.draft,
    };
  }
  return loadVersion(backend.db, backend.root, pid);
}

function backupName(text) {
  try {
    const value = JSON.parse(text)?.name;
    return typeof value === 'string' && value.trim() ? value.trim() : 'Проект';
  } catch { return 'Проект'; }
}

function projectTextHash(text) {
  try { return hashText(JSON.stringify(JSON.parse(text))); }
  catch { return hashText(String(text || '')); }
}

async function backupLocalDifference(localText, remoteText) {
  if (!localText || !remoteText || projectTextHash(localText) === projectTextHash(remoteText)) return null;
  const stamp = new Date().toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  let body;
  try {
    const data = JSON.parse(localText);
    data.name = `${backupName(localText)} — резерв ${stamp}`;
    body = JSON.stringify(data);
  } catch { body = localText; }
  const pid = newId('p');
  try {
    await saveVersion(backend.db, backend.root, body, {
      pid, note: 'Автоматическая копия перед загрузкой модели с другого устройства', stats: projectStats(),
    });
    toast('Несинхронизированные изменения сохранены отдельным резервным проектом');
    return pid;
  } catch {
    try {
      const local = await getLocalBackend();
      await saveVersion(local.db, local.root, body, {
        pid, note: 'Локальный резерв перед передачей между устройствами', stats: projectStats(),
      });
      toast('Изменения сохранены локальной резервной копией', true);
      return pid;
    } catch {
      toast('Не удалось создать резерв; локальный черновик оставлен в браузере', true);
      return null;
    }
  }
}

async function preserveQueuedProjectBeforeSwitch(targetPid) {
  const currentPid = state.pid;
  if (activeEditor || !currentPid || currentPid === targetPid) return true;
  const queued = pendingCloudDrafts.get(currentPid) || pendingUnassignedDraft;
  if (!queued?.text) return true;
  // Обычное переключение не должно плодить проекты «— резерв». Сначала
  // подтверждаем тот же автосохранённый черновик в основном проекте. Если
  // облако недоступно или проект занят другим устройством, переключение
  // блокируется, а локальный автосейв остаётся на месте.
  const saved = await flushCloudDraft({ allowStartLease: true });
  const stillPending = pendingCloudDrafts.has(currentPid)
    || latestDraftOrder.has(currentPid) || pendingUnassignedDraft === queued;
  if (!saved || stillPending || uncertainCloudWrites.size) {
    toast('Основной проект ещё не сохранился в облаке. Дождитесь подтверждения и повторите.', true);
    return false;
  }
  if (activeEditor?.pid === currentPid) await detachActiveEditor();
  return true;
}

async function releaseCandidateLease(pid, lease) {
  if (!lease || !usesEditLease()) return;
  if (activeEditor?.pid === pid && leaseHeldBy(activeEditor.lease, lease)) return;
  try { await releaseEditLease(backend.db, backend.root, pid, lease); } catch { /* best effort */ }
}

async function activateLoadedProject(pid, lease, loaded, name = null, { localBackup = null } = {}) {
  state.editLocked = true;
  state.editLockReason = 'loading';
  cancelEditingGesture();
  if (localBackup) await backupLocalDifference(localBackup, loaded.text);
  if (activeEditor) await detachActiveEditor({ release: activeEditor.pid !== pid });
  try {
    // Сначала восстанавливаем inert стартового окна, затем openText закрывает
    // его. Иначе edit-lock мог вернуть устаревший inert уже открытому редактору.
    hideEditLock();
    openText(loaded.text, pid, loaded.missing, name || loaded.meta?.name, { resetHistory: true });
    if (lease) startActiveEditor(pid, lease); else unlockEditor();
    // openText выполнялся под логической блокировкой, поэтому его tweak не
    // планировал локальное сохранение. Повторяем после подтверждённого lease.
    tweak(() => {});
    if (loaded.localOnly) scheduleCloudDraft(loaded.text, { immediate: true });
  } catch (error) {
    await releaseCandidateLease(pid, lease);
    throw error;
  }
}

export async function continueCurrentProject({ reloading = false, savedAt = null, pid = state.pid, restoreTab } = {}) {
  if (loginGateActive()) return false;
  if (!pid) { unlockEditor(); closeStartMenu(); return true; }
  try {
    if (!backend || (account.provider === 'firebase' && account.signedIn && !usesEditLease())) backend = await getBackend();
    if (account.signedIn && (backend.uid !== account.user?.uid || (account.provider === 'firebase' && !usesEditLease()))) {
      throw new Error('Нет связи с хранилищем этого аккаунта');
    }
  } catch (error) {
    toast(`Не удалось открыть облако: ${projectErrorText(error)}`, true);
    return false;
  }
  const otherProject = pid !== state.pid;
  if (!usesEditLease() && !otherProject) { unlockEditor(); closeStartMenu(); return true; }
  let localText = null;
  let candidateLease = null;
  if (!otherProject) {
    try { localText = serializeProject(state.project, { pretty: false }); } catch { /* загрузка ниже покажет ошибку */ }
  }
  try {
    const { lease, contended } = await acquireProjectLease(pid, { kind: 'occupied' });
    if (usesEditLease() && !lease) return false;
    candidateLease = lease;
    setEditLockBusy(true, 'Загружаем последнюю модель из облака…');
    const loaded = lease ? await loadLatestServerProject(pid, null, { fallbackText: localText }) : await loadVersion(backend.db, backend.root, pid);
    if (otherProject) {
      // Общий автосейв принадлежит другой вкладке. Открываем только
      // сохранённый проект по ID этой вкладки. Запишем его после первой правки.
      const previous = state.project;
      const previousPid = state.pid;
      const project = deserializeProject(loaded.text);
      state.pid = pid;
      try { restoreTab(project); }
      catch (error) {
        state.pid = previousPid;
        restoreTab(previous);
        throw error;
      }
      if (lease) startActiveEditor(pid, lease); else unlockEditor();
      fitView();
      closeStartMenu();
      return true;
    }
    const remoteAt = loaded.version?.at || loaded.meta?.updatedAt;
    const matchesRemote = !loaded.localOnly && localText === loaded.text;
    // При обычном F5 последняя локальная правка может ещё ожидать отправки.
    // После подтверждения lease сохраняем её в тот же проект. При передаче
    // с другого устройства действует обычная защита конфликтующих версий.
    if (reloading && !contended && (matchesRemote || (savedAt && !shouldUseRemoteProject(state.project, savedAt, remoteAt)))) {
      startActiveEditor(pid, lease);
      closeStartMenu();
      if (!matchesRemote) scheduleCloudDraft(localText, { immediate: true });
    } else {
      const backup = !reloading || contended || !savedAt ? localText : null;
      await activateLoadedProject(pid, lease, loaded, loaded.meta?.name, { localBackup: backup });
    }
    return true;
  } catch (error) {
    await releaseCandidateLease(pid, candidateLease);
    const message = projectErrorText(error);
    if (el('editLockScreen').hidden) toast(`Не удалось открыть проект: ${message}`, true);
    else setEditLockBusy(false, message, 'error');
    return false;
  }
}

async function reclaimLostProject() {
  const lost = lostEditor;
  if (!lost?.pid || !usesEditLease()) return;
  let candidateLease = null;
  setEditLockBusy(true, 'Проверяем право редактирования…');
  try {
    let result = await acquireEditLease(backend.db, backend.root, lost.pid, editorIdentity);
    let lease = result.status === 'acquired' ? result.lease : null;
    if (!lease) {
      const waiting = waitForRequestedLease(lost.pid, result.lease, { kind: 'moved' });
      await requestPendingLease();
      lease = await waiting;
    }
    if (!lease) return;
    candidateLease = lease;
    setEditLockBusy(true, 'Загружаем последнюю модель из облака…');
    const loaded = await loadLatestServerProject(lost.pid, null, { fallbackText: lost.localText });
    await activateLoadedProject(lost.pid, lease, loaded, loaded.meta?.name, { localBackup: lost.localText });
  } catch (error) {
    await releaseCandidateLease(lost.pid, candidateLease);
    setEditLockBusy(false, projectErrorText(error), 'error');
  }
}

async function handleEditLockContinue() {
  if (pendingLeaseFlow) { await requestPendingLease(); return; }
  if (lostEditor) await reclaimLostProject();
}

async function handleEditLockProjects() {
  const pending = pendingLeaseFlow;
  setEditLockBusy(true, 'Возвращаемся к проектам…');
  if (pending) {
    try {
      await cancelEditLeaseRequest(backend.db, backend.root, pending.pid, editorIdentity);
      const current = await acquireEditLease(backend.db, backend.root, pending.pid, editorIdentity);
      if (current.status === 'acquired' && leaseHeldBy(current.lease, editorIdentity)) {
        await releaseCandidateLease(pending.pid, current.lease);
      }
    } catch { /* запрос мог уже исчезнуть */ }
    finishPendingLease(null);
  }
  hideEditLock();
  if (activeEditor) {
    state.editLocked = false;
    state.editLockReason = '';
    lostEditor = null;
    return;
  }
  state.editLocked = true;
  state.editLockReason = 'choose-project';
  await openProjectChooser({ initial: true });
}

async function saveReplacementBackup(text) {
  if (!text) return;
  try {
    const local = await getLocalBackend();
    await saveVersion(local.db, local.root, text, {
      pid: newId('p'), note: 'Резерв перед переключением проекта', stats: null,
    });
    toast('Последние изменения прежнего проекта сохранены локальной резервной копией', true);
  } catch {
    toast('Не удалось синхронизировать прежний проект; его локальная копия оставлена в браузере', true);
  }
}

function handleProjectReplaced(event) {
  if (replacementBusy) {
    state.editLocked = true;
    state.editLockReason = 'switching-project';
    return;
  }
  const previousPid = event.detail?.previousPid || null;
  const previousText = event.detail?.previousText || null;
  const current = activeEditor?.pid === previousPid ? activeEditor : null;
  if (!current) {
    if (previousPid && usesEditLease()) clearHistory();
    unlockEditor();
    tweak(() => {});
    return;
  }
  replacementBusy = true;
  const target = backend;
  state.editLocked = true;
  state.editLockReason = 'switching-project';
  cancelEditingGesture();
  showEditLock({
    kind: 'saving',
    status: 'Отправляем последние изменения в облако…',
  });
  setEditLockBusy(true, 'Отправляем последние изменения в облако…');
  setSyncStatus('Сохраняем прежний проект…', 'saving');
  // files.js уже вызвал flushAutosave до замены модели, поэтому очередь
  // содержит именно прежний снимок, хотя state.project теперь уже новый.
  void (async () => {
    let saved = false;
    try {
      saved = await flushCloudDraft();
    } catch { /* ниже останется локальная резервная копия */ }
    if (!saved) {
      await saveReplacementBackup(previousText);
      clearPendingFor(previousPid);
    }
    if (activeEditor === current) stopLeaseMonitoring();
    if (usesEditLease(target)) {
      releaseEditLease(target.db, target.root, previousPid, current.lease)
        .catch(() => { /* при офлайне аренда сама истечёт */ });
    }
    clearHistory();
    replacementBusy = false;
    unlockEditor();
    tweak(() => {});
  })();
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
  syncProjectNameUi();
  pendingCloudDrafts.set(pid, { ...pendingUnassignedDraft, pid });
  latestDraftOrder.set(pid, pendingUnassignedDraft.order);
  pendingUnassignedDraft = null;
}

function scheduleCloudDraft(text, { immediate = false } = {}) {
  if (typeof text === 'string' && text) {
    // Снимок создаётся вместе с конкретным JSON, пока state.project всё ещё
    // относится к нему. Иначе при быстром переключении проектов в очередь
    // могло попасть изображение уже следующей модели.
    const preview = currentProjectThumbnail();
    const draft = {
      text, preview, stats: projectStats(), order: ++draftOrder,
    };
    if (backend?.mode === 'cloud') {
      const pid = state.pid || newId('p');
      state.pid = pid;
      setScopedItem(PID_KEY, pid);
      syncProjectNameUi();
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

async function flushCloudDraft({ allowStartLease = false } = {}) {
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
      let editor = null;
      if (usesEditLease(target)) {
        if (!activeEditor || activeEditor.pid !== pid || !leaseHeldBy(activeEditor.lease, editorIdentity)) {
          // Стартовый список проектов ещё не означает, что пользователь
          // решил редактировать локально открытый проект. Явное переключение
          // — исключение: перед ним разрешено подтвердить уже готовый автосейв
          // в основном проекте, не создавая отдельный «резерв».
          const canSaveBeforeSwitch = allowStartLease && pid === state.pid;
          if ((!el('startScreen').hidden && !canSaveBeforeSwitch) || pid !== state.pid) {
            ok = false;
            if (sameBackend(backend, target) && !pendingCloudDrafts.has(pid)) pendingCloudDrafts.set(pid, draft);
            continue;
          }
          try {
            const acquired = await acquireEditLease(target.db, target.root, pid, editorIdentity);
            if (acquired.status !== 'acquired') {
              ok = false;
              lastError = new Error('Этот проект уже редактируется на другом устройстве');
              if (!pendingCloudDrafts.has(pid)) pendingCloudDrafts.set(pid, draft);
              markLeaseLost(acquired.lease, lastError.message, pid);
              continue;
            }
            startActiveEditor(pid, acquired.lease);
          } catch (error) {
            ok = false;
            lastError = error;
            if (!pendingCloudDrafts.has(pid)) pendingCloudDrafts.set(pid, draft);
            continue;
          }
        }
        if (leaseExpired(activeEditor.lease, Date.now() + LEASE_SAFETY_MARGIN)) {
          const renewed = sameBackend(backend, target) && await maintainEditorLease(true);
          if (!renewed) {
            ok = false;
            lastError = new Error(state.editLocked
              ? 'Проект передан другому устройству'
              : 'Нет подтверждённой связи с облаком; повторим сохранение позже');
            if (!state.editLocked && sameBackend(backend, target)
              && !pendingCloudDrafts.has(pid)) pendingCloudDrafts.set(pid, draft);
            continue;
          }
        }
        editor = { sessionId: activeEditor.lease.sessionId, epoch: activeEditor.lease.epoch };
      }
      const operation = saveDraft(target.db, target.root, draft.text, {
        pid, preview: draft.preview, stats: draft.stats, editor,
      });
      try {
        const saved = await withSaveTimeout(operation);
        savedAt = saved.draft.updatedAt;
        if (latestDraftOrder.get(pid) === draft.order) latestDraftOrder.delete(pid);
      } catch (error) {
        ok = false;
        lastError = error;
        if (error?.code === 'edit-lease-lost') {
          const renewed = activeEditor?.pid === pid && sameBackend(backend, target)
            ? await maintainEditorLease(true)
            : false;
          if (!state.editLocked && sameBackend(backend, target)
            && latestDraftOrder.get(pid) === draft.order
            && !pendingCloudDrafts.has(pid)) pendingCloudDrafts.set(pid, draft);
          if (!state.editLocked) lastError = new Error(renewed
            ? 'Право редактирования восстановлено; повторяем сохранение'
            : 'Нет подтверждённой связи с облаком; изменения сохранены на устройстве');
          continue;
        }
        if (error?.code === 'cloud-timeout') rememberUncertainWrite(operation);
        // Более новый снимок того же проекта уже содержит все прошлые правки.
        if (sameBackend(backend, target) && latestDraftOrder.get(pid) === draft.order
          && !pendingCloudDrafts.has(pid)) pendingCloudDrafts.set(pid, draft);
      }
    }
    if (sameBackend(backend, target)) {
      if (ok) setSyncStatus(`Сохранено в облаке ${fmtDate(savedAt)}`, 'saved');
      else setSyncStatus(`Не удалось синхронизировать: ${lastError?.message || 'ошибка'}`, 'error');
      if (hasPendingCloudDraft() && !uncertainCloudWrites.size && el('startScreen').hidden) scheduleCloudDraft(null);
    }
    return ok;
  };
  syncChain = syncChain.then(run, run);
  return syncChain;
}

function activeEditorFence(pid = state.pid) {
  if (!activeEditor || activeEditor.pid !== pid || !leaseHeldBy(activeEditor.lease, editorIdentity)) return null;
  return { sessionId: activeEditor.lease.sessionId, epoch: activeEditor.lease.epoch };
}

async function flushActiveProject(message = 'Текущий проект ещё не попал в облако. Проверьте интернет и повторите.') {
  if (!activeEditor) return true;
  flushAutosave({ cloudImmediate: true });
  if (await flushCloudDraft()) return true;
  toast(message, true);
  return false;
}

async function flushBeforeSwitch(message = 'Текущий проект ещё не попал в облако. Проверьте интернет и повторите.') {
  if (activeEditor) return flushActiveProject(message);
  flushAutosave({ cloudImmediate: true });
  if (await flushCloudDraft()) return true;
  toast(message, true);
  return false;
}

async function saveCurrent() {
  const button = el('prjSave');
  button.disabled = true;
  try {
    if (!backend) backend = await getBackend();
    const pid = state.pid || newId('p');
    if (!state.pid) {
      state.pid = pid;
      setScopedItem(PID_KEY, pid);
      syncProjectNameUi();
    }
    if (usesEditLease()) {
      if (activeEditor && activeEditor.pid !== pid) {
        if (!await flushActiveProject()) return;
        await detachActiveEditor();
      }
      const { lease } = await acquireProjectLease(pid, { kind: 'occupied' });
      if (!lease) return;
      if (!activeEditor || activeEditor.pid !== pid) startActiveEditor(pid, lease);
    }
    const text = serializeProject(state.project);
    const options = {
      pid,
      note: el('prjNote').value.trim(),
      preview: currentProjectThumbnail(),
      stats: projectStats(),
    };
    let editor = usesEditLease() ? activeEditorFence(pid) : null;
    let saved;
    try {
      saved = await saveVersion(backend.db, backend.root, text, { ...options, editor });
    } catch (error) {
      if (error?.code !== 'edit-lease-lost' || !await maintainEditorLease(true)) throw error;
      editor = activeEditorFence(pid);
      if (!editor) throw error;
      saved = await saveVersion(backend.db, backend.root, text, { ...options, editor });
    }
    const { unchanged, meta } = saved;
    tweak(() => {});
    el('prjNote').value = '';
    if (backend.mode === 'cloud') setSyncStatus('Контрольная версия сохранена в облаке', 'saved');
    toast(unchanged ? 'Без изменений с последней версии' : `Версия сохранена (всего ${meta.versions.length})`);
  } catch (error) {
    const message = error?.code === 'edit-lease-lost' && !state.editLocked
      ? 'Нет подтверждённой связи с облаком. Изменения остались на этом устройстве.'
      : projectErrorText(error);
    toast(`Не сохранилось: ${message}`, true);
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
      const meta = projects.find((candidate) => candidate.id === pid);
      const name = state.pid === pid ? currentProjectName() : meta?.name;
      if (usesEditLease()) {
        if (!await preserveQueuedProjectBeforeSwitch(pid)) return;
        if (!await flushActiveProject()) return;
        let lease = null;
        try {
          ({ lease } = await acquireProjectLease(pid, { kind: 'occupied' }));
          if (!lease) return;
          const localBackup = state.pid === pid
            ? serializeProject(state.project, { pretty: false })
            : null;
          const loaded = await loadLatestServerProject(pid, vid || null);
          await activateLoadedProject(pid, lease, loaded, loaded.meta?.name, { localBackup });
        } catch (error) {
          await releaseCandidateLease(pid, lease);
          throw error;
        }
      } else {
        flushAutosave();
        if (!await flushCloudDraft()) {
          toast('Текущий проект ещё не попал в облако. Проверьте интернет и повторите.', true);
          return;
        }
        const { text, missing } = await loadVersion(backend.db, backend.root, pid, vid || null);
        openText(text, pid, missing, name);
      }
    } else if (act === 'open-shared') {
      if (!await flushBeforeSwitch()) return;
      const { text, missing } = await loadShared(backend.db, owner, pid);
      await detachActiveEditor();
      openText(text, null, missing);
    } else if (act === 'delete') {
      const project = projects.find((candidate) => candidate.id === pid);
      if (!window.confirm(`Удалить «${project?.name || 'проект'}» со всеми версиями?`)) return;
      if (!await flushBeforeSwitch('Облачное сохранение ещё не подтвердилось. Дождитесь статуса и повторите удаление.')) return;
      if (hasPendingCloudDraft() || uncertainCloudWrites.size) {
        toast('Появились новые несохранённые изменения. Повторите удаление после синхронизации.', true);
        return;
      }
      let lease = null;
      const wasActive = activeEditor?.pid === pid;
      if (usesEditLease()) {
        ({ lease } = await acquireProjectLease(pid, { kind: 'occupied' }));
        if (!lease) return;
      }
      clearTimeout(syncTimer);
      syncTimer = null;
      pendingCloudDrafts.delete(pid);
      latestDraftOrder.delete(pid);
      if (state.pid === pid) pendingUnassignedDraft = null;
      deleteBusyPid = pid;
      try {
        const editor = lease ? { sessionId: lease.sessionId, epoch: lease.epoch } : null;
        await deleteProject(backend.db, backend.root, pid, { editor });
      } catch (error) {
        if (!wasActive) await releaseCandidateLease(pid, lease);
        throw error;
      } finally {
        deleteBusyPid = null;
      }
      if (wasActive) stopLeaseMonitoring();
      if (lease) {
        try { await releaseEditLease(backend.db, backend.root, pid, lease); } catch { /* lease истечёт */ }
      }
      if (state.pid === pid) {
        state.pid = null;
        setScopedItem(PID_KEY, '');
        syncProjectNameUi();
        discardAutosave();
        clearHistory();
        unlockEditor();
      }
      toast('Проект удалён');
    } else if (act === 'publish') {
      if (backend.provider !== 'claude') throw new Error('Общие публикации недоступны для Google-облака');
      if (!window.confirm('Опубликовать снимок? Его смогут открыть все пользователи, вошедшие в kep•ler 3D.')) return;
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
    toast(`Ошибка: ${projectErrorText(error)}`, true);
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
  const nextBackend = await getBackend();
  if (activeEditor && backend && !sameBackend(backend, nextBackend)) await detachActiveEditor();
  backend = nextBackend;
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
  rememberEditor(false);
  el('projectsScreen').hidden = false;
  el('projectsList').innerHTML = '<p class="hint">Загрузка…</p>';
  account = await getAccountState();
  renderAccount();
  await refreshBackend({ restartWatch: false });
  setTab(backend.provider === 'claude' ? tab : 'mine');
}

export async function openProjectChooser(options = {}) {
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
  if (el('startScreen').hidden && !state.editLocked && !loginGateActive()) rememberEditor(true);
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
    await detachActiveEditor();
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
  bindEditLockUi({
    onContinue: handleEditLockContinue,
    onProjects: handleEditLockProjects,
  });
  el('projectsBtn').addEventListener('click', openProjects);
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
  el('startRecentProjects').addEventListener('dblclick', (event) => {
    if (event.target.closest('.startup-project-card')) event.preventDefault();
  });
  document.addEventListener(AUTOSAVE_EVENT, (event) => {
    scheduleCloudDraft(event.detail?.text, {
      immediate: event.detail?.immediate === true || document.visibilityState === 'hidden',
    });
  });
  document.addEventListener(PROJECT_NAME_EVENT, () => {
    if (isProjectsOpen()) render();
    if (!el('startProjectsView').hidden && !el('startScreen').hidden) renderStartProjects(projects);
  });
  document.addEventListener(PROJECT_REPLACED_EVENT, handleProjectReplaced);
  window.addEventListener('online', async () => {
    if (activeEditor && !await maintainEditorLease(true)) return;
    if (hasPendingCloudDraft()) scheduleCloudDraft(null, { immediate: true });
  });
  window.addEventListener('offline', () => {
    if (activeEditor) {
      activeEditor.connectionUncertain = true;
      setSyncStatus('Офлайн — изменения сохраняются на этом устройстве', 'saving');
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushAutosave({ cloudImmediate: true });
      flushCloudDraft();
    } else if (activeEditor) maintainEditorLease(true);
  });
  window.addEventListener('pagehide', () => {
    flushAutosave({ cloudImmediate: true });
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

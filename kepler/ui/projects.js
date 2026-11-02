// Панель «Проекты»: сохранённые версии (мои), общие (опубликованные для
// просмотра). Облако claude.ai или браузер — см. ui/cloud.js.

import { serializeProject } from '../core/model.js';
import {
  deleteProject, loadShared, loadVersion, newId, publishProject, saveVersion,
  unpublishProject, watchProjects, watchShared,
} from '../core/storage.js';
import { el, escapeHtml, refs, toast } from './dom.js';
import { getBackend } from './cloud.js';
import { state } from './state.js';
import {
  PID_KEY, pushHistory, restoreFrom, snapshot, tweak,
} from './store.js';
import { fitView } from './view.js';

let backend = null;
let tab = 'mine'; // 'mine' | 'shared'
let unwatch = null;
let projects = [];
let shared = [];
const expanded = new Set();

export const isProjectsOpen = () => !el('projectsScreen').hidden;

const fmtDate = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
};
const fmtSize = (n) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} МБ` : `${Math.max(1, Math.round(n / 1024))} КБ`);

function projectStats() {
  const levels = state.project.levels || [];
  return { rooms: levels.reduce((s, l) => s + l.rooms.length, 0), levels: levels.length };
}

function stopWatching() {
  unwatch?.();
  unwatch = null;
}

function watch() {
  stopWatching();
  const fail = (e) => { el('projectsList').innerHTML = `<p class="hint">Не удалось загрузить: ${escapeHtml(e?.message || 'нет доступа')}</p>`; };
  if (tab === 'mine') unwatch = watchProjects(backend.db, backend.root, (list) => { projects = list; render(); }, fail);
  else unwatch = watchShared(backend.db, (list) => { shared = list; render(); }, fail);
}

function versionRows(p) {
  return p.versions.map((v, i) => `
    <div class="prj-ver">
      <span>${escapeHtml(fmtDate(v.at))}${v.note ? ` · ${escapeHtml(v.note)}` : ''}${i === 0 ? ' · последняя' : ''}</span>
      <small>${fmtSize(v.bytes || 0)}</small>
      <button type="button" data-act="open" data-pid="${p.id}" data-vid="${v.id}">Открыть</button>
    </div>`).join('');
}

function render() {
  const box = el('projectsList');
  if (!backend) return;
  if (tab === 'mine') {
    if (!projects.length) {
      box.innerHTML = '<p class="hint">Пока ничего не сохранено. Нажмите «Сохранить версию» — проект появится здесь.</p>';
      return;
    }
    box.innerHTML = projects.map((p) => {
      const open = expanded.has(p.id);
      const current = p.id === state.pid;
      return `
      <div class="prj-row${current ? ' current' : ''}">
        <div class="prj-main">
          <b>${escapeHtml(p.name || 'Без названия')}</b>${current ? ' <em>(открыт)</em>' : ''}
          <small>${escapeHtml(fmtDate(p.updatedAt))} · версий: ${p.versions.length}</small>
        </div>
        <div class="prj-actions">
          <button type="button" data-act="open" data-pid="${p.id}">Открыть</button>
          <button type="button" data-act="toggle" data-pid="${p.id}">${open ? 'Версии ▴' : 'Версии ▾'}</button>
          ${backend.mode === 'cloud' ? `<button type="button" data-act="publish" data-pid="${p.id}" title="Опубликовать снимок: его увидят все, кто открыл артефакт">Опубликовать</button>` : ''}
          <button type="button" class="danger" data-act="delete" data-pid="${p.id}">Удалить</button>
        </div>
        ${open ? `<div class="prj-vers">${versionRows(p)}</div>` : ''}
      </div>`;
    }).join('');
  } else {
    if (!shared.length) {
      box.innerHTML = '<p class="hint">Общих проектов нет. Опубликуйте свой на вкладке «Мои проекты».</p>';
      return;
    }
    box.innerHTML = shared.map((it) => {
      const mine = it.owner === backend.uid;
      return `
      <div class="prj-row">
        <div class="prj-main">
          <b>${escapeHtml(it.name || 'Без названия')}</b>${mine ? ' <em>(мой)</em>' : ''}
          <small>${escapeHtml(fmtDate(it.at))}${it.stats ? ` · комнат: ${it.stats.rooms ?? 0}` : ''}</small>
        </div>
        <div class="prj-actions">
          <button type="button" data-act="open-shared" data-owner="${escapeHtml(it.owner)}" data-pid="${it.pid}">Открыть копией</button>
          ${mine ? `<button type="button" class="danger" data-act="unpublish" data-pid="${it.pid}">Снять</button>` : ''}
        </div>
      </div>`;
    }).join('');
  }
}

function openText(text, pid, missing) {
  const before = snapshot();
  restoreFrom(text);
  pushHistory(before);
  state.pid = pid;
  refs.projectName.value = state.project.name;
  tweak(() => {});
  fitView();
  closeProjects();
  toast(missing?.length ? `Открыт «${state.project.name}», но картинка топосъёмки потерялась` : `Открыт проект «${state.project.name}»`, Boolean(missing?.length));
}

async function saveCurrent() {
  const btn = el('prjSave');
  btn.disabled = true;
  try {
    const pid = state.pid || newId('p');
    const { unchanged, meta } = await saveVersion(backend.db, backend.root, serializeProject(state.project), {
      pid, note: el('prjNote').value.trim(), stats: projectStats(),
    });
    state.pid = pid;
    tweak(() => {});
    el('prjNote').value = '';
    toast(unchanged ? 'Без изменений с последней версии' : `Версия сохранена (всего ${meta.versions.length})`);
  } catch (error) {
    toast(`Не сохранилось: ${error.message}`, true);
  } finally {
    btn.disabled = false;
  }
}

async function onAction(btn) {
  const { act, pid, vid, owner } = btn.dataset;
  try {
    if (act === 'toggle') {
      if (expanded.has(pid)) expanded.delete(pid); else expanded.add(pid);
      render();
    } else if (act === 'open') {
      const { text, missing } = await loadVersion(backend.db, backend.root, pid, vid || null);
      openText(text, pid, missing);
    } else if (act === 'open-shared') {
      const { text, missing } = await loadShared(backend.db, owner, pid);
      openText(text, null, missing); // чужой снимок открывается копией: сохранение создаст свой проект
    } else if (act === 'delete') {
      const p = projects.find((x) => x.id === pid);
      if (!window.confirm(`Удалить «${p?.name || 'проект'}» со всеми версиями?`)) return;
      await deleteProject(backend.db, backend.root, pid);
      if (state.pid === pid) { state.pid = null; tweak(() => {}); }
      toast('Проект удалён');
    } else if (act === 'publish') {
      const { text } = await loadVersion(backend.db, backend.root, pid);
      await publishProject(backend.db, backend.uid, text, { pid, stats: projectStats() });
      toast('Опубликовано: снимок виден всем во вкладке «Общие»');
    } else if (act === 'unpublish') {
      await unpublishProject(backend.db, backend.uid, pid);
      toast('Публикация снята');
    }
  } catch (error) {
    toast(`Ошибка: ${error.message}`, true);
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

export async function openProjects() {
  el('projectsScreen').hidden = false;
  el('projectsList').innerHTML = '<p class="hint">Загрузка…</p>';
  backend = await getBackend();
  const cloud = backend.mode === 'cloud';
  el('projectsMode').textContent = cloud
    ? 'Облако claude.ai: проекты привязаны к вашей учётной записи.'
    : `Хранятся в этом браузере${backend.persistent ? '' : ' (до закрытия вкладки: браузер не дал сохранить)'}. Для облака откройте страницу как артефакт claude.ai.`;
  el('prjTabShared').hidden = !cloud;
  setTab(cloud ? tab : 'mine');
}

export function closeProjects() {
  el('projectsScreen').hidden = true;
  stopWatching();
}

export function bindProjects() {
  try { state.pid = localStorage.getItem(PID_KEY) || null; } catch { /* нет хранилища */ }
  el('projectsBtn').addEventListener('click', openProjects);
  el('projectsClose').addEventListener('click', closeProjects);
  el('projectsScreen').addEventListener('click', (e) => { if (e.target.id === 'projectsScreen') closeProjects(); });
  el('prjTabMine').addEventListener('click', () => setTab('mine'));
  el('prjTabShared').addEventListener('click', () => setTab('shared'));
  el('prjSave').addEventListener('click', saveCurrent);
  el('projectsList').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (btn) onAction(btn);
  });
}
